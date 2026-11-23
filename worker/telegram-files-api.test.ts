import { describe, expect, it } from 'vitest';
import {
  handleTelegramFileDownload,
  type TelegramFileD1Database,
  type TelegramFileD1Statement,
} from './telegram-files-api';

interface StoredRow {
  id: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  telegram_file_id: string | null;
  storage_path: string | null;
}

class FakeStatement implements TelegramFileD1Statement {
  values: unknown[] = [];
  constructor(private readonly db: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>(): Promise<T | null> { return this.db.first<T>(this.values); }
}

class FakeD1 implements TelegramFileD1Database {
  row: StoredRow | null = null;
  queries: Array<{ sql: string; values: unknown[] }> = [];
  prepare(sql: string) {
    this.queries.push({ sql, values: [] });
    return new FakeStatement(this);
  }
  first<T>(values: unknown[]): T | null {
    const last = this.queries[this.queries.length - 1];
    if (last) last.values = values;
    return this.row as T | null;
  }
}

const profile = { id: 'user-a', organization_id: 'org-a', is_active: true };
const stored: StoredRow = {
  id: 'file-a',
  original_name: 'بارنامه.pdf',
  mime_type: 'application/pdf',
  size_bytes: 4,
  telegram_file_id: 'telegram-file-id-a',
  storage_path: 'telegram://chat-a/message-a',
};
const env = { MIGRATION_DB: new FakeD1(), TELEGRAM_BOT_TOKEN: 'never-return-this-token' };
const request = (path = '/api/files/file-a/download', origin = 'https://staging.example') =>
  new Request('https://staging.example' + path, {
    method: 'GET',
    headers: { origin, 'sec-fetch-site': 'same-origin', cookie: 'session=opaque' },
  });

const telegramFetcher = (
  filePath = 'documents/file_a.pdf',
  fileSize = 4,
  bytes = new Uint8Array([1, 2, 3, 4]),
  ok = true,
): typeof fetch => async (input, init) => {
  const url = String(input);
  if (url.endsWith('/getFile')) {
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    return new Response(JSON.stringify({
      ok,
      ...(ok ? { result: { file_path: filePath, file_size: fileSize } } : {}),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.byteLength) },
  });
};

describe('Cloudflare Telegram file recovery', () => {
  it('streams a tenant-owned Telegram binary with the stored file name and MIME type', async () => {
    const db = new FakeD1();
    db.row = stored;
    const response = await handleTelegramFileDownload(
      request(), { MIGRATION_DB: db, TELEGRAM_BOT_TOKEN: 'test-token' },
      new URL('https://staging.example/api/files/file-a/download'), profile,
      telegramFetcher(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('filename*=UTF-8');
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('x-file-source')).toBe('telegram');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3, 4]);
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].sql).toContain('organization_id = ?');
    expect(db.queries[0].values).toEqual(['file-a', 'org-a']);
  });

  it('does not query D1 for cross-origin download requests', async () => {
    const db = new FakeD1();
    const response = await handleTelegramFileDownload(
      request('/api/files/file-a/download', 'https://attacker.example'),
      { MIGRATION_DB: db, TELEGRAM_BOT_TOKEN: 'test-token' },
      new URL('https://staging.example/api/files/file-a/download'), profile,
      telegramFetcher(),
    );
    expect(response.status).toBe(403);
    expect(db.queries).toHaveLength(0);
  });

  it('does not expose a file belonging to another organization', async () => {
    const db = new FakeD1();
    const response = await handleTelegramFileDownload(
      request(), { MIGRATION_DB: db, TELEGRAM_BOT_TOKEN: 'test-token' },
      new URL('https://staging.example/api/files/file-a/download'), profile,
      telegramFetcher(),
    );
    expect(response.status).toBe(404);
    expect(db.queries[0].values).toEqual(['file-a', 'org-a']);
  });

  it('refuses to guess a Telegram file ID when Metadata does not contain it', async () => {
    const db = new FakeD1();
    db.row = { ...stored, telegram_file_id: null };
    let fetchCalls = 0;
    const fetcher: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response('unexpected');
    };
    const response = await handleTelegramFileDownload(
      request(), { MIGRATION_DB: db, TELEGRAM_BOT_TOKEN: 'test-token' },
      new URL('https://staging.example/api/files/file-a/download'), profile, fetcher,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'TELEGRAM_FILE_ID_MISSING' });
    expect(fetchCalls).toBe(0);
  });

  it('rejects files over Telegram getFile download limit before fetching bytes', async () => {
    const db = new FakeD1();
    db.row = { ...stored, size_bytes: 20 * 1024 * 1024 + 1 };
    let fetchCalls = 0;
    const fetcher: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response('unexpected');
    };
    const response = await handleTelegramFileDownload(
      request(), { MIGRATION_DB: db, TELEGRAM_BOT_TOKEN: 'test-token' },
      new URL('https://staging.example/api/files/file-a/download'), profile, fetcher,
    );
    expect(response.status).toBe(413);
    expect(fetchCalls).toBe(0);
  });

  it('rejects an unsafe file path returned by Telegram', async () => {
    const db = new FakeD1();
    db.row = stored;
    let downloadCalls = 0;
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/getFile')) {
        return new Response(JSON.stringify({
          ok: true, result: { file_path: '../secret', file_size: 4 },
        }), { headers: { 'content-type': 'application/json' } });
      }
      downloadCalls += 1;
      return new Response('unexpected');
    };
    const response = await handleTelegramFileDownload(
      request(), { MIGRATION_DB: db, TELEGRAM_BOT_TOKEN: 'test-token' },
      new URL('https://staging.example/api/files/file-a/download'), profile, fetcher,
    );
    expect(response.status).toBe(404);
    expect(downloadCalls).toBe(0);
  });

  it('rejects missing Telegram configuration without exposing any token value', async () => {
    const db = new FakeD1();
    db.row = stored;
    const response = await handleTelegramFileDownload(
      request(), { MIGRATION_DB: db },
      new URL('https://staging.example/api/files/file-a/download'), profile,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('never-return-this-token');
  });
});
