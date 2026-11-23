export interface TelegramFileD1Statement {
  bind(...values: unknown[]): TelegramFileD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface TelegramFileD1Database {
  prepare(sql: string): TelegramFileD1Statement;
}

export interface TelegramFilesApiEnvironment {
  MIGRATION_DB: TelegramFileD1Database;
  TELEGRAM_BOT_TOKEN?: string;
}

export interface TelegramFilesApiProfile {
  id: string;
  organization_id: string;
  is_active: boolean;
}

interface StoredTelegramFile {
  id: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  telegram_file_id: string | null;
  storage_path: string | null;
}

interface TelegramGetFileResponse {
  ok: boolean;
  result?: {
    file_size?: number;
    file_path?: string;
  };
}

const MAX_TELEGRAM_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const TELEGRAM_REQUEST_TIMEOUT_MS = 30_000;
const FILE_ROUTE_PREFIX = '/api/files/';
const FILE_ROUTE_SUFFIX = '/download';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  },
});

const fail = (code: string, status: number) => json({ ok: false, error: code }, status);

const isSameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
};

const getFileIdFromPath = (pathname: string): string | null => {
  if (!pathname.startsWith(FILE_ROUTE_PREFIX) || !pathname.endsWith(FILE_ROUTE_SUFFIX)) return null;
  const raw = pathname.slice(FILE_ROUTE_PREFIX.length, -FILE_ROUTE_SUFFIX.length);
  if (!raw || raw.includes('/')) return null;
  try {
    const id = decodeURIComponent(raw);
    return id && id.length <= 128 && !id.includes('/') ? id : null;
  } catch {
    return null;
  }
};

const fetchWithTimeout = async (
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const isSafeTelegramFilePath = (value: string) => {
  const parts = value.split('/');
  return parts.length > 0 && parts.every((part) =>
    Boolean(part) && part !== '.' && part !== '..' && /^[A-Za-z0-9._-]+$/.test(part)
  );
};

const safeMimeType = (value: string | null) => {
  if (value && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(value)) return value;
  return 'application/octet-stream';
};

const hasControlCharacters = (value: string) => Array.from(value).some((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint < 0x21 || codePoint === 0x7f;
});

const encodeFileName = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    '%' + character.charCodeAt(0).toString(16).toUpperCase()
  );

export const handleTelegramFileDownload = async (
  request: Request,
  env: TelegramFilesApiEnvironment,
  url: URL,
  profile: TelegramFilesApiProfile,
  fetcher: typeof fetch = fetch,
): Promise<Response> => {
  if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405);
  if (!profile.is_active || !profile.organization_id) return fail('FORBIDDEN', 403);
  if (!isSameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  if (!env.TELEGRAM_BOT_TOKEN) return fail('TELEGRAM_NOT_CONFIGURED', 503);

  const id = getFileIdFromPath(url.pathname);
  if (!id) return fail('INVALID_FILE_ID', 400);

  let stored: StoredTelegramFile | null;
  try {
    stored = await env.MIGRATION_DB.prepare(
      'SELECT id, original_name, mime_type, size_bytes, ' +
      "json_extract(metadata, '$.telegramFileId') AS telegram_file_id, storage_path " +
      'FROM file_manager_files WHERE id = ? AND organization_id = ? ' +
      'AND json_valid(metadata) = 1 LIMIT 1'
    ).bind(id, profile.organization_id).first<StoredTelegramFile>();
  } catch {
    return fail('FILE_METADATA_UNAVAILABLE', 503);
  }
  if (!stored) return fail('FILE_NOT_FOUND', 404);
  if (!stored.telegram_file_id || stored.telegram_file_id.length > 1024 ||
      hasControlCharacters(stored.telegram_file_id)) {
    return fail('TELEGRAM_FILE_ID_MISSING', 409);
  }
  if (stored.size_bytes != null &&
      (!Number.isSafeInteger(stored.size_bytes) || stored.size_bytes < 0 || stored.size_bytes > MAX_TELEGRAM_DOWNLOAD_BYTES)) {
    return fail('TELEGRAM_DOWNLOAD_LIMIT_EXCEEDED', 413);
  }

  const apiBase = 'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN;
  let lookupResponse: Response;
  try {
    lookupResponse = await fetchWithTimeout(fetcher, apiBase + '/getFile', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ file_id: stored.telegram_file_id }),
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    return fail('TELEGRAM_LOOKUP_UNAVAILABLE', 502);
  }
  if (!lookupResponse.ok) return fail('TELEGRAM_LOOKUP_FAILED', 502);

  let lookup: TelegramGetFileResponse;
  try { lookup = await lookupResponse.json() as TelegramGetFileResponse; }
  catch { return fail('TELEGRAM_INVALID_RESPONSE', 502); }
  const filePath = lookup.result?.file_path || '';
  const telegramSize = lookup.result?.file_size;
  if (!lookup.ok || !isSafeTelegramFilePath(filePath)) return fail('TELEGRAM_FILE_NOT_AVAILABLE', 404);
  if (telegramSize != null &&
      (!Number.isSafeInteger(telegramSize) || telegramSize < 0 || telegramSize > MAX_TELEGRAM_DOWNLOAD_BYTES)) {
    return fail('TELEGRAM_DOWNLOAD_LIMIT_EXCEEDED', 413);
  }

  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  let fileResponse: Response;
  try {
    fileResponse = await fetchWithTimeout(fetcher, 'https://api.telegram.org/file/bot' + env.TELEGRAM_BOT_TOKEN + '/' + encodedPath, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    return fail('TELEGRAM_DOWNLOAD_UNAVAILABLE', 502);
  }
  if (!fileResponse.ok || !fileResponse.body) return fail('TELEGRAM_DOWNLOAD_FAILED', 502);

  const headerSize = Number(fileResponse.headers.get('content-length') || 0);
  if (headerSize > MAX_TELEGRAM_DOWNLOAD_BYTES) {
    await fileResponse.body.cancel().catch(() => undefined);
    return fail('TELEGRAM_DOWNLOAD_LIMIT_EXCEEDED', 413);
  }

  let transferred = 0;
  const limitedBody = fileResponse.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      transferred += chunk.byteLength;
      if (transferred > MAX_TELEGRAM_DOWNLOAD_BYTES) {
        throw new Error('TELEGRAM_DOWNLOAD_LIMIT_EXCEEDED');
      }
      controller.enqueue(chunk);
    },
  }));

  const originalName = Array.from(stored.original_name || 'telegram-file', (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f || character === '"' ? '_' : character;
  }).join('').slice(0, 180);
  const headers = new Headers({
    'content-type': safeMimeType(stored.mime_type),
    'content-disposition': 'attachment; filename="download"; filename*=UTF-8\'\'' + encodeFileName(originalName),
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  });
  if (telegramSize != null) headers.set('x-file-size', String(telegramSize));
  headers.set('x-file-source', 'telegram');
  return new Response(limitedBody, { status: 200, headers });
};
