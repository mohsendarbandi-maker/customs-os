import type { FileManagerD1Database, FileManagerApiProfile } from './file-manager-api';

const BASE = '/api/file-manager';
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const TELEGRAM_TIMEOUT_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UploadEnvironment {
  MIGRATION_DB: FileManagerD1Database;
  TELEGRAM_BOT_TOKEN?: string;
}

interface ArchiveDestinationRow {
  eligible_records: number;
  distinct_chat_ids: number;
  distinct_connection_ids: number;
  chat_id: string | null;
  connection_id: string | null;
}

interface UploadJob {
  id: string;
  organization_id: string;
  idempotency_key: string;
  file_manager_file_id: string;
  folder_id: string;
  shipment_id: string | null;
  client_id: string | null;
  original_name: string;
  document_name: string;
  mime_type: string;
  size_bytes: number;
  document_type: string;
  tags: string;
  status: string;
  telegram_chat_id: string | null;
  telegram_connection_id: string | null;
  telegram_file_id: string | null;
  telegram_file_unique_id: string | null;
  external_message_id: string | null;
  error_code: string | null;
  created_by: string;
}

interface UploadFolder {
  id: string;
  organization_id: string;
  client_id: string | null;
  shipment_id: string | null;
  folder_type: string;
  display_name: string;
  relative_path: string | null;
}

interface TelegramSendDocumentResponse {
  ok: boolean;
  description?: string;
  result?: {
    message_id?: number;
    chat?: { id?: number | string };
    document?: {
      file_id?: string;
      file_unique_id?: string;
      file_size?: number;
      file_name?: string;
      mime_type?: string;
    };
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  },
});
const fail = (error: string, status: number) => json({ ok: false, error }, status);
const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
};
const normalizeName = (value: string, fallback = 'document.bin') => {
  const safe = value.normalize('NFKC').replace(/[\\/\\\\]/g, '_')
    .replace(/[\\u0000-\\u001f\\u007f]/g, '_')
    .replace(/^\\.+/, '').trim().slice(0, 180);
  return safe || fallback;
};
const normalizeTags = (raw: string | null) => {
  if (!raw) return [] as string[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((value): value is string => typeof value === 'string')
      .map(value => normalizeName(value, '').replace(/,/g, ' ').trim()).filter(Boolean))].slice(0, 20);
  } catch {
    return [];
  }
};
const normalizeMime = (value: string | null) => {
  const mime = (value || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9.+_-]+\\/[a-z0-9.+_-]+$/i.test(mime) ? mime : 'application/octet-stream';
};
const withExtension = (name: string, mime: string) => {
  if (/\\.[a-z0-9]{1,12}$/i.test(name)) return name;
  const extensions: Record<string, string> = {
    'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png',
    'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic',
    'application/zip': 'zip', 'application/x-zip-compressed': 'zip',
    'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json',
    'application/octet-stream': 'bin',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  return name + '.' + (extensions[mime] || 'bin');
};
const readBodyBounded = async (request: Request, declaredSize: number): Promise<Uint8Array> => {
  if (!request.body) throw new Error('EMPTY_FILE_BODY');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_ARCHIVE_BYTES || total > declaredSize) {
        await reader.cancel();
        throw new Error('FILE_SIZE_MISMATCH');
      }
      chunks.push(part.value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* stream already closed */ }
  }
  if (total !== declaredSize || total <= 0) throw new Error('FILE_SIZE_MISMATCH');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const archiveDestinationSql =
  'SELECT ' +
  'COUNT(CASE WHEN json_valid(metadata) AND ' +
  'NULLIF(json_extract(metadata, \'$.telegramChatId\'), \'\') IS NOT NULL AND ' +
  'NULLIF(json_extract(metadata, \'$.telegramConnectionId\'), \'\') IS NOT NULL THEN 1 END) AS eligible_records, ' +
  'COUNT(DISTINCT CASE WHEN json_valid(metadata) THEN NULLIF(json_extract(metadata, \'$.telegramChatId\'), \'\') END) AS distinct_chat_ids, ' +
  'COUNT(DISTINCT CASE WHEN json_valid(metadata) THEN NULLIF(json_extract(metadata, \'$.telegramConnectionId\'), \'\') END) AS distinct_connection_ids, ' +
  'MIN(CASE WHEN json_valid(metadata) THEN NULLIF(json_extract(metadata, \'$.telegramChatId\'), \'\') END) AS chat_id, ' +
  'MIN(CASE WHEN json_valid(metadata) THEN NULLIF(json_extract(metadata, \'$.telegramConnectionId\'), \'\') END) AS connection_id ' +
  'FROM file_manager_files WHERE organization_id=?';

const resolveDestination = async (db: FileManagerD1Database, organizationId: string) => {
  const destination = await db.prepare(archiveDestinationSql)
    .bind(organizationId).first<ArchiveDestinationRow>();
  if (
    !destination ||
    Number(destination.eligible_records) < 1 ||
    Number(destination.distinct_chat_ids) !== 1 ||
    Number(destination.distinct_connection_ids) !== 1 ||
    !destination.chat_id ||
    !/^-?\\d{1,20}$/.test(destination.chat_id) ||
    !destination.connection_id ||
    !UUID.test(destination.connection_id)
  ) return null;
  return {
    chatId: destination.chat_id,
    connectionId: destination.connection_id,
  };
};

export const getFileManagerArchiveStatus = async (
  db: FileManagerD1Database,
  profile: FileManagerApiProfile,
): Promise<Response> => {
  if (!profile.is_active || !profile.organization_id) return fail('FORBIDDEN', 403);
  try {
    const row = await db.prepare(archiveDestinationSql)
      .bind(profile.organization_id).first<ArchiveDestinationRow>();
    const configured = Boolean(
      row &&
      Number(row.eligible_records) > 0 &&
      Number(row.distinct_chat_ids) === 1 &&
      Number(row.distinct_connection_ids) === 1 &&
      row.chat_id &&
      /^-?\\d{1,20}$/.test(row.chat_id) &&
      row.connection_id &&
      UUID.test(row.connection_id),
    );
    // Return aggregate status only. Telegram chat/connection identifiers stay
    // inside the Worker and are never returned to the browser.
    return json({
      ok: true,
      configured,
      sourceRecords: Number(row?.eligible_records || 0),
      distinctChatIds: Number(row?.distinct_chat_ids || 0),
      distinctConnections: Number(row?.distinct_connection_ids || 0),
      maxUploadBytes: MAX_ARCHIVE_BYTES,
      binaryStorage: 'telegram',
    });
  } catch {
    return fail('FILE_ARCHIVE_STATUS_UNAVAILABLE', 503);
  }
};

const completeUploadJob = async (
  db: FileManagerD1Database,
  profile: FileManagerApiProfile,
  job: UploadJob,
) => {
  if (
    job.status !== 'receipt_recorded' ||
    !job.telegram_file_id ||
    !job.telegram_chat_id ||
    !job.telegram_connection_id ||
    !job.external_message_id
  ) return fail('FILE_UPLOAD_RECONCILIATION_REQUIRED', 409);

  const folder = await db.prepare(
    'SELECT relative_path FROM file_manager_folders WHERE id=? AND organization_id=? LIMIT 1',
  ).bind(job.folder_id,profile.organization_id).first<{ relative_path: string | null }>();
  if (!folder) return fail('FILE_ARCHIVE_FOLDER_INVALID',404);
  const relativePath = [folder.relative_path,job.document_name].filter(Boolean).join('/');
  const createdAt = new Date().toISOString();
  const metadata = {
    source: 'cloudflare_worker_telegram_archive',
    transferMode: 'stream',
    telegramFileId: job.telegram_file_id,
    telegramFileUniqueId: job.telegram_file_unique_id,
    telegramMessageId: job.external_message_id,
    telegramChatId: job.telegram_chat_id,
    telegramConnectionId: job.telegram_connection_id,
    documentName: job.document_name,
    documentType: job.document_type,
    archiveJobId: job.id,
  };
  const after = {
    id: job.file_manager_file_id,
    folder_id: job.folder_id,
    shipment_id: job.shipment_id,
    client_id: job.client_id,
    file_asset_id: job.file_manager_file_id,
    original_name: job.original_name,
    mime_type: job.mime_type,
    size_bytes: job.size_bytes,
    external_message_id: job.external_message_id,
    document_type: job.document_type,
    tags: JSON.parse(job.tags || '[]'),
    metadata,
    storage_path: 'telegram://' + job.file_manager_file_id,
    is_archived: false,
    organization_id: profile.organization_id,
  };
  try {
    await db.batch([
      db.prepare(
        'INSERT OR IGNORE INTO file_manager_files ' +
        '(id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,' +
        'external_message_id,document_type,tags,metadata,shipment_document_id,customs_document_id,' +
        'storage_path,operation_sections,is_archived,created_at,organization_id,relative_path) ' +
        'SELECT ?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,\'[]\',0,?,?,? ' +
        'WHERE EXISTS (SELECT 1 FROM file_manager_folders WHERE id=? AND organization_id=?)',
      ).bind(
        job.file_manager_file_id,job.folder_id,job.shipment_id,job.client_id,job.file_manager_file_id,
        job.original_name,job.mime_type,job.size_bytes,job.external_message_id,job.document_type,
        job.tags,JSON.stringify(metadata),'telegram://' + job.file_manager_file_id,createdAt,
        profile.organization_id,
        relativePath,
        job.folder_id,profile.organization_id,
      ),
      db.prepare(
        'INSERT INTO customs_os_audit_events ' +
        '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
        'SELECT ?,?,?,?,?,?,?,?,? WHERE changes() > 0',
      ).bind(
        crypto.randomUUID(),profile.organization_id,profile.id,'create','file_manager_file',
        job.file_manager_file_id,null,JSON.stringify(after),'telegram-upload:' + job.id,
      ),
      db.prepare(
        'UPDATE file_manager_upload_jobs SET status=\'stored\',error_code=NULL,updated_at=? ' +
        'WHERE id=? AND organization_id=? AND status=\'receipt_recorded\'',
      ).bind(createdAt,job.id,profile.organization_id),
    ]);
    const stored = await db.prepare(
      'SELECT id,file_asset_id,external_message_id,size_bytes FROM file_manager_files ' +
      'WHERE id=? AND organization_id=? LIMIT 1',
    ).bind(job.file_manager_file_id,profile.organization_id)
      .first<{id:string;file_asset_id:string|null;external_message_id:string|null;size_bytes:number}>();
    if (!stored || stored.file_asset_id !== job.file_manager_file_id) return fail('FILE_ARCHIVE_METADATA_SAVE_FAILED',503);
    return json({
      ok:true,
      fileAssetId:stored.file_asset_id,
      externalMessageId:stored.external_message_id,
      sizeBytes:Number(stored.size_bytes),
      folderId:job.folder_id,
      uploadJobId:job.id,
      alreadyStored:job.status==='stored',
    },201);
  } catch {
    return fail('FILE_ARCHIVE_METADATA_SAVE_FAILED',503);
  }
};

const uploadJobSelect =
  'SELECT id,organization_id,idempotency_key,file_manager_file_id,folder_id,shipment_id,client_id,' +
  'original_name,document_name,mime_type,size_bytes,document_type,tags,status,telegram_chat_id,' +
  'telegram_connection_id,telegram_file_id,telegram_file_unique_id,external_message_id,error_code,created_by ' +
  'FROM file_manager_upload_jobs WHERE organization_id=? AND idempotency_key=? LIMIT 1';

export const handleFileManagerUpload = async (
  request: Request,
  env: UploadEnvironment,
  url: URL,
  profile: FileManagerApiProfile,
  fetcher: typeof fetch = fetch,
): Promise<Response> => {
  if (!profile.is_active || !profile.organization_id) return fail('FORBIDDEN',403);
  if (!sameOrigin(request,url)) return fail('ORIGIN_FORBIDDEN',403);
  if (request.method !== 'POST' || url.pathname !== BASE + '/uploads') return fail('METHOD_NOT_ALLOWED',405);
  if (!['owner','admin','broker','accountant','warehouse','client'].includes(profile.role)) return fail('FILE_ARCHIVE_ROLE_FORBIDDEN',403);
  if (!env.TELEGRAM_BOT_TOKEN) return fail('TELEGRAM_NOT_CONFIGURED',503);

  const folderId = (url.searchParams.get('folder_id') || '').trim();
  const requestedShipmentId = (url.searchParams.get('shipment_id') || '').trim();
  const documentType = normalizeName(url.searchParams.get('document_type') || 'other');
  const requestedDocumentName = (url.searchParams.get('document_name') || '').trim();
  const tags = normalizeTags(url.searchParams.get('tags'));
  const idempotencyKey = (request.headers.get('idempotency-key') || '').trim();
  const rawName = request.headers.get('x-file-name') || '';
  const declaredSizeText = request.headers.get('x-file-size') || request.headers.get('content-length') || '';
  const mimeType = normalizeMime(request.headers.get('content-type'));

  if (!UUID.test(folderId) || !idempotencyKey || idempotencyKey.length > 180 ||
      !rawName || !/^\\d+$/.test(declaredSizeText)) {
    return fail('INVALID_FILE_ARCHIVE_INPUT',400);
  }
  const declaredSize = Number(declaredSizeText);
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > MAX_ARCHIVE_BYTES) {
    return fail('FILE_TOO_LARGE_FOR_DESTINATION',413);
  }
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) !== declaredSize) return fail('FILE_SIZE_MISMATCH',400);

  let originalName: string;
  try { originalName = normalizeName(decodeURIComponent(rawName)); }
  catch { return fail('INVALID_FILE_NAME',400); }
  originalName = withExtension(originalName,mimeType);
  const finalDocumentName = withExtension(requestedDocumentName ? normalizeName(requestedDocumentName) : originalName,mimeType);

  try {
    const folder = await env.MIGRATION_DB.prepare(
      'SELECT id,organization_id,client_id,shipment_id,folder_type,display_name,relative_path ' +
      'FROM file_manager_folders WHERE id=? AND organization_id=? LIMIT 1',
    ).bind(folderId,profile.organization_id).first<UploadFolder>();
    if (!folder) return fail('FILE_ARCHIVE_FOLDER_INVALID',404);
    if (profile.role === 'client' && (!profile.client_id || folder.client_id !== profile.client_id)) {
      return fail('FILE_ACCESS_DENIED',403);
    }
    if (requestedShipmentId && requestedShipmentId !== folder.shipment_id) return fail('FILE_ARCHIVE_FOLDER_INVALID',409);
    if (requestedShipmentId && !UUID.test(requestedShipmentId)) return fail('INVALID_SHIPMENT_ID',400);
    const shipmentId = folder.shipment_id || null;
    const clientId = folder.client_id || null;
    const destination = await resolveDestination(env.MIGRATION_DB,profile.organization_id);
    if (!destination) return fail('FILE_ARCHIVE_NOT_CONFIGURED_OR_AMBIGUOUS',409);

    let job = await env.MIGRATION_DB.prepare(uploadJobSelect)
      .bind(profile.organization_id,idempotencyKey).first<UploadJob>();

    if (job) {
      if (
        job.folder_id !== folderId ||
        job.shipment_id !== shipmentId ||
        job.client_id !== clientId ||
        job.original_name !== originalName ||
        job.mime_type !== mimeType ||
        Number(job.size_bytes) !== declaredSize ||
        job.document_name !== finalDocumentName ||
        job.document_type !== documentType ||
        job.tags !== JSON.stringify(tags)
      ) return fail('IDEMPOTENCY_KEY_REUSE_MISMATCH',409);
      if (job.status === 'stored') {
        return json({
          ok:true,fileAssetId:job.file_manager_file_id,externalMessageId:job.external_message_id,
          sizeBytes:job.size_bytes,folderId:job.folder_id,uploadJobId:job.id,alreadyStored:true,
        });
      }
      if (job.status === 'receipt_recorded') return completeUploadJob(env.MIGRATION_DB,profile,job);
      if (job.status === 'uploading' || job.status === 'reconcile_required') {
        return fail('FILE_UPLOAD_RECONCILIATION_REQUIRED',409);
      }
      if (job.status !== 'failed' || job.telegram_file_id || job.external_message_id) {
        return fail('FILE_UPLOAD_JOB_NOT_RETRYABLE',409);
      }
      const retry = await env.MIGRATION_DB.prepare(
        'UPDATE file_manager_upload_jobs SET status=\'uploading\',error_code=NULL,updated_at=? ' +
        'WHERE id=? AND organization_id=? AND status=\'failed\' AND telegram_file_id IS NULL AND external_message_id IS NULL',
      ).bind(new Date().toISOString(),job.id,profile.organization_id).run();
      if (!retry.meta?.changes) return fail('FILE_UPLOAD_RECONCILIATION_REQUIRED',409);
      job = { ...job,status:'uploading',error_code:null };
    } else {
      const jobId = crypto.randomUUID();
      const fileId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const inserted = await env.MIGRATION_DB.prepare(
        'INSERT OR IGNORE INTO file_manager_upload_jobs ' +
        '(id,organization_id,idempotency_key,file_manager_file_id,folder_id,shipment_id,client_id,' +
        'original_name,document_name,mime_type,size_bytes,document_type,tags,status,telegram_chat_id,' +
        'telegram_connection_id,telegram_file_id,telegram_file_unique_id,external_message_id,error_code,' +
        'created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,\'uploading\',NULL,NULL,NULL,NULL,NULL,NULL,?,?,?)',
      ).bind(
        jobId,profile.organization_id,idempotencyKey,fileId,folderId,shipmentId,clientId,
        originalName,finalDocumentName,mimeType,declaredSize,documentType,JSON.stringify(tags),
        profile.id,createdAt,createdAt,
      ).run();
      if (!inserted.meta?.changes) {
        const concurrent = await env.MIGRATION_DB.prepare(uploadJobSelect)
          .bind(profile.organization_id,idempotencyKey).first<UploadJob>();
        if (concurrent?.status === 'stored') return json({
          ok:true,fileAssetId:concurrent.file_manager_file_id,externalMessageId:concurrent.external_message_id,
          sizeBytes:concurrent.size_bytes,folderId:concurrent.folder_id,uploadJobId:concurrent.id,alreadyStored:true,
        });
        return fail('FILE_UPLOAD_RECONCILIATION_REQUIRED',409);
      }
      job = await env.MIGRATION_DB.prepare(uploadJobSelect)
        .bind(profile.organization_id,idempotencyKey).first<UploadJob>() || null;
      if (!job) return fail('FILE_UPLOAD_JOB_CREATE_FAILED',503);
    }

    let bytes: Uint8Array;
    try {
      bytes = await readBodyBounded(request,declaredSize);
    } catch {
      await env.MIGRATION_DB.prepare(
        'UPDATE file_manager_upload_jobs SET status=\'failed\',error_code=\'FILE_SIZE_MISMATCH\',updated_at=? ' +
        'WHERE id=? AND organization_id=? AND status=\'uploading\'',
      ).bind(new Date().toISOString(),job.id,profile.organization_id).run();
      return fail('FILE_SIZE_MISMATCH',400);
    }

    const caption = [
      'Customs OS',
      finalDocumentName,
      'Type: ' + documentType,
      'Folder: ' + String(folder.relative_path || folder.display_name || folderId).slice(0,160),
      ...tags.slice(0,8).map(tag => '#' + tag.normalize('NFKC').replace(/\\s+/g,'_').replace(/[^\\p{L}\\p{N}_-]/gu,'').slice(0,32)),
      '#CustomsOS',
    ].join('\\n').slice(0,950);

    const form = new FormData();
    form.set('chat_id',destination.chatId);
    form.set('caption',caption);
    form.set('document',new Blob([bytes],{type:mimeType}),originalName);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(),TELEGRAM_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetcher('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendDocument',{
        method:'POST',body:form,signal:abort.signal,
      });
    } catch {
      await env.MIGRATION_DB.prepare(
        'UPDATE file_manager_upload_jobs SET status=\'reconcile_required\',error_code=\'TELEGRAM_UPLOAD_OUTCOME_UNKNOWN\',updated_at=? ' +
        'WHERE id=? AND organization_id=? AND status=\'uploading\'',
      ).bind(new Date().toISOString(),job.id,profile.organization_id).run().catch(() => undefined);
      return fail('FILE_UPLOAD_RECONCILIATION_REQUIRED',409);
    } finally {
      clearTimeout(timer);
    }

    let telegram: TelegramSendDocumentResponse;
    try { telegram = await response.json() as TelegramSendDocumentResponse; }
    catch {
      await env.MIGRATION_DB.prepare(
        'UPDATE file_manager_upload_jobs SET status=\'reconcile_required\',error_code=\'TELEGRAM_INVALID_RESPONSE\',updated_at=? ' +
        'WHERE id=? AND organization_id=? AND status=\'uploading\'',
      ).bind(new Date().toISOString(),job.id,profile.organization_id).run();
      return fail('FILE_UPLOAD_RECONCILIATION_REQUIRED',409);
    }
    const telegramFileId = telegram.result?.document?.file_id;
    const telegramMessageId = telegram.result?.message_id;
    const actualChatId = String(telegram.result?.chat?.id ?? destination.chatId);
    if (!response.ok || !telegram.ok || !telegramFileId || !telegramMessageId || actualChatId !== destination.chatId) {
      await env.MIGRATION_DB.prepare(
        'UPDATE file_manager_upload_jobs SET status=\'failed\',error_code=\'TELEGRAM_UPLOAD_FAILED\',updated_at=? ' +
        'WHERE id=? AND organization_id=? AND status=\'uploading\'',
      ).bind(new Date().toISOString(),job.id,profile.organization_id).run();
      return fail('TELEGRAM_UPLOAD_FAILED',502);
    }

    const receiptSaved = await env.MIGRATION_DB.prepare(
      'UPDATE file_manager_upload_jobs SET status=\'receipt_recorded\',telegram_chat_id=?,' +
      'telegram_connection_id=?,telegram_file_id=?,telegram_file_unique_id=?,external_message_id=?,error_code=NULL,updated_at=? ' +
      'WHERE id=? AND organization_id=? AND status=\'uploading\'',
    ).bind(
      destination.chatId,destination.connectionId,telegramFileId,telegram.result?.document?.file_unique_id || null,
      String(telegramMessageId),new Date().toISOString(),job.id,profile.organization_id,
    ).run();
    if (!receiptSaved.meta?.changes) return fail('FILE_UPLOAD_RECONCILIATION_REQUIRED',409);

    const receipt = await env.MIGRATION_DB.prepare(uploadJobSelect)
      .bind(profile.organization_id,idempotencyKey).first<UploadJob>();
    if (!receipt) return fail('FILE_UPLOAD_RECONCILIATION_REQUIRED',409);
    return completeUploadJob(env.MIGRATION_DB,profile,receipt);
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    return fail(code === 'FILE_UPLOAD_RECONCILIATION_REQUIRED' ? code : 'FILE_MANAGER_UPLOAD_NOT_READY',503);
  }
};
