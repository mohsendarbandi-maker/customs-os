export type CloudflareFileManagerFolder = {
  id: string;
  parent_id: string | null;
  folder_key: string;
  folder_type: string;
  display_name: string;
  client_id: string | null;
  shipment_id: string | null;
  customs_office_id: string | null;
  is_system: boolean;
  created_at: string;
  organization_id?: string;
  relative_path?: string | null;
  file_count?: number;
};

export type CloudflareFileManagerFile = {
  id: string;
  folder_id: string;
  shipment_id: string | null;
  client_id: string | null;
  file_asset_id: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  external_message_id: string | null;
  document_type: string;
  tags: string[];
  metadata: Record<string, unknown>;
  shipment_document_id: string | null;
  customs_document_id: string | null;
  storage_path: string | null;
  operation_sections: string[];
  is_archived: boolean;
  created_at: string;
  organization_id?: string;
  relative_path?: string | null;
};

export class CloudflareFileManagerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CloudflareFileManagerError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new Error('ارتباط با سرویس فایل‌منیجر Cloudflare برقرار نشد.');
  }

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || body?.ok === false) {
    const code = typeof body?.error === 'string' ? body.error : 'FILE_MANAGER_REQUEST_FAILED';
    throw new CloudflareFileManagerError(code, response.status);
  }
  if (!body) throw new CloudflareFileManagerError('INVALID_FILE_MANAGER_RESPONSE', 502);
  return body as T;
}

export async function listCloudflareFileManagerFolders(): Promise<{ folders: CloudflareFileManagerFolder[] }> {
  return request('/api/file-manager/folders');
}

export async function listCloudflareFileManagerFiles(
  folderId: string,
  limit = 100,
  offset = 0,
): Promise<{ items: CloudflareFileManagerFile[]; total: number; limit: number; offset: number }> {
  const query = new URLSearchParams({
    folder_id: folderId,
    limit: String(limit),
    offset: String(offset),
  });
  return request('/api/file-manager/files?' + query.toString());
}

export async function searchCloudflareFileManager(
  query: string,
  limit = 50,
): Promise<{ items: Array<{
  entity_type: string;
  entity_id: string;
  title: string;
  details: string | null;
  folder_id: string | null;
  shipment_id: string | null;
  client_id: string | null;
}>; total: number; normalizedQuery?: string }> {
  const params = new URLSearchParams({ q: query, limit: String(Math.min(50, Math.max(1, limit))) });
  return request('/api/file-manager/search?' + params.toString());
}

export async function createCloudflareFileManagerFolder(input: {
  parent_id: string;
  display_name: string;
}): Promise<{ folder: CloudflareFileManagerFolder }> {
  return request('/api/file-manager/folders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}


export type CloudflareFileManagerArchiveStatus = {
  configured: boolean;
  sourceRecords: number;
  distinctChatIds: number;
  distinctConnections: number;
  maxUploadBytes: number;
  binaryStorage: 'telegram' | string;
};

export type CloudflareFileManagerUpload = {
  fileAssetId: string;
  externalMessageId: string;
  sizeBytes: number;
  folderId: string;
  uploadJobId: string;
  alreadyStored: boolean;
};

export async function getCloudflareFileManagerArchiveStatus(): Promise<CloudflareFileManagerArchiveStatus> {
  return request('/api/file-manager/archive-status');
}

export async function createCloudflareFileManagerUploadIdempotencyKey(
  file: File,
  input: {
    folderId: string;
    shipmentId?: string;
    documentType: string;
    documentName: string;
    tags: string[];
    operationSections: string[];
  },
): Promise<string> {
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
    throw new Error('حجم فایل برای آرشیو تلگرام باید بین ۱ بایت تا ۲۰ مگابایت باشد.');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('مرورگر امکان ساخت کلید امن آپلود را ندارد؛ از مرورگر به‌روز روی HTTPS استفاده کنید.');
  }
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const context = [
    'customs-os-d1-telegram-upload-v1',
    input.folderId,
    input.shipmentId || '',
    input.documentType,
    input.documentName,
    file.name,
    file.type || 'application/octet-stream',
    String(file.size),
    [...input.tags].sort().join('|'),
    [...input.operationSections].sort().join('|'),
    hash,
  ].join('\\n');
  const key = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context));
  return 'customs-os-upload-v1:' +
    Array.from(new Uint8Array(key), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function uploadCloudflareFileManagerFile(
  file: File,
  input: {
    folderId: string;
    shipmentId?: string;
    documentType: string;
    documentName: string;
    tags: string[];
    operationSections: string[];
    idempotencyKey: string;
  },
): Promise<CloudflareFileManagerUpload> {
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
    throw new Error('حجم فایل برای آرشیو تلگرام باید حداکثر ۲۰ مگابایت باشد.');
  }
  const query = new URLSearchParams({
    folder_id: input.folderId,
    ...(input.shipmentId ? { shipment_id: input.shipmentId } : {}),
    document_type: input.documentType,
    document_name: input.documentName,
    tags: JSON.stringify(input.tags.slice(0, 20)),
    operation_sections: JSON.stringify(input.operationSections.slice(0, 20)),
  });
  let response: Response;
  try {
    response = await fetch('/api/file-manager/uploads?' + query.toString(), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Size': String(file.size),
        'Idempotency-Key': input.idempotencyKey,
      },
      body: file,
    });
  } catch {
    throw new Error('ارسال فایل به Worker ناموفق بود؛ وضعیت آرشیو را پیش از تلاش مجدد بررسی کنید.');
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || body?.ok !== true) {
    const code = typeof body?.error === 'string' ? body.error : 'FILE_UPLOAD_FAILED';
    const messages: Record<string, string> = {
      FILE_ARCHIVE_NOT_CONFIGURED_OR_AMBIGUOUS: 'شناسه مقصد آرشیو از فایل‌های قدیمی یکتا نیست؛ برای جلوگیری از ارسال به گروه اشتباه، آپلود متوقف شد.',
      FILE_UPLOAD_RECONCILIATION_REQUIRED: 'تلگرام ممکن است فایل را دریافت کرده باشد، اما رسید D1 قطعی نیست؛ ارسال مجدد خودکار مسدود شد تا فایل تکراری ایجاد نشود.',
      FILE_ARCHIVE_FOLDER_INVALID: 'پوشه انتخابی در D1 معتبر نیست یا به این محموله/صاحب کالا تعلق ندارد.',
      FILE_ACCESS_DENIED: 'برای این پوشه مجوز آپلود ندارید.',
      TELEGRAM_NOT_CONFIGURED: 'توکن ربات تلگرام روی Worker تنظیم نشده است.',
      TELEGRAM_UPLOAD_FAILED: 'تلگرام فایل را نپذیرفت؛ هیچ رکورد موفقی ثبت نشد.',
      FILE_ARCHIVE_METADATA_SAVE_FAILED: 'تلگرام رسید فایل را برگرداند، اما ثبت نهایی D1 کامل نشد؛ بازیابی همان Job لازم است.',
      FILE_TOO_LARGE_FOR_DESTINATION: 'حجم فایل از سقف ۲۰ مگابایت بیشتر است.',
    };
    throw new CloudflareFileManagerError(messages[code] || code, response.status);
  }
  if (
    typeof body.fileAssetId !== 'string' ||
    typeof body.externalMessageId !== 'string' ||
    typeof body.folderId !== 'string' ||
    typeof body.uploadJobId !== 'string'
  ) throw new CloudflareFileManagerError('INVALID_FILE_MANAGER_UPLOAD_RECEIPT', 502);
  return body as unknown as CloudflareFileManagerUpload;
}

export async function downloadCloudflareFileManagerFile(fileAssetId: string): Promise<Blob> {
  if (!fileAssetId) throw new Error('شناسه فایل معتبر نیست.');
  const response = await fetch('/api/files/' + encodeURIComponent(fileAssetId) + '/download', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    const code = typeof body.error === 'string' ? body.error : 'TELEGRAM_DOWNLOAD_FAILED';
    throw new CloudflareFileManagerError(code, response.status);
  }
  return response.blob();
}

export async function archiveCloudflareFileManagerFile(fileId: string): Promise<{ archived: boolean }> {
  return request('/api/file-manager/files/' + encodeURIComponent(fileId) + '/archive', {
    method: 'POST',
  });
}

export async function restoreCloudflareFileManagerFile(fileId: string): Promise<{ restored: boolean }> {
  return request('/api/file-manager/files/' + encodeURIComponent(fileId) + '/restore', {
    method: 'POST',
  });
}
