import { supabase } from './supabase';

export type FileArchiveDestination = {
  connectionId: string;
  chatId: string;
  displayName: string;
};

export type TelegramArchiveUpload = {
  fileAssetId: string;
  externalMessageId: string;
  sizeBytes: number | null;
  folderId: string;
  uploadJobId: string;
  alreadyStored: boolean;
};

const FILE_ARCHIVE_MAX_DOWNLOADABLE_BYTES = 20 * 1024 * 1024;

/**
 * Builds a deterministic idempotency key from the upload context and bytes.
 * The same file can therefore be safely retried after a page reload or network
 * interruption, while a changed file, folder, or archive destination gets a
 * different key. This hashes bytes only; it does not inspect or parse content.
 */
export async function createTelegramArchiveIdempotencyKey(
  file: File,
  input: {
    folderId: string;
    shipmentId?: string;
    documentType?: string;
    documentName?: string;
    destination: FileArchiveDestination;
  },
): Promise<string> {
  if (file.size <= 0 || file.size > FILE_ARCHIVE_MAX_DOWNLOADABLE_BYTES) {
    throw new Error('حجم فایل برای آرشیو قابل بازیابی تلگرام باید بین ۱ بایت تا ۲۰ مگابایت باشد.');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('مرورگر امکان ساخت کلید امن برای جلوگیری از آپلود تکراری را ندارد؛ از مرورگر به‌روز روی HTTPS استفاده کنید.');
  }

  const contentDigest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const contentHash = Array.from(new Uint8Array(contentDigest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const context = [
    'customs-os-telegram-upload-v1',
    input.folderId,
    input.shipmentId || '',
    input.destination.connectionId,
    input.destination.chatId,
    file.name,
    file.type || 'application/octet-stream',
    String(file.size),
    input.documentType || 'other',
    input.documentName || file.name,
    contentHash,
  ].join('\n');
  const keyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context));
  const keyHash = Array.from(new Uint8Array(keyDigest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `customs-os-upload-v1:${keyHash}`;
}

async function authorizedRequest(path: string, init: RequestInit = {}) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error('نشست معتبر نیست؛ دوباره وارد وب‌سایت شوید.');
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  const apiKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;
  if (apiKey) headers.set('apikey', apiKey);
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      cache: 'no-store',
    });
  } catch {
    throw new Error('درخواست آپلود به سرور نرسید. اتصال اینترنت را بررسی کنید؛ اگر دوباره تکرار شد، صفحهٔ فایل‌منیجر را تازه‌سازی کنید و ارسال را مجدداً انجام دهید.');
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok === false) {
      const code = String(body?.error || 'REQUEST_FAILED');
      if (code === 'FILE_ARCHIVE_NOT_CONFIGURED') {
        throw new Error('مقصد خصوصی «آرشیو فایل» تلگرام هنوز تنظیم نشده است. از تنظیمات پیام‌رسان‌ها، یک مقصد تلگرام با کاربرد «آرشیو فایل» ثبت کنید؛ از مقصد گزارش روزانه استفاده نکنید.');
      }
      if (code === 'FILE_UPLOAD_RECONCILIATION_REQUIRED' || code === 'FILE_UPLOAD_JOB_ALREADY_EXISTS_RETRY_WITH_STATUS_CHECK') {
        throw new Error('وضعیت ارسال این فایل قطعی نیست و برای جلوگیری از ایجاد نسخه تکراری، دوباره ارسال نشد. ابتدا وضعیت آرشیو را بررسی کنید.');
      }
      if (code === 'FILE_TOO_LARGE_FOR_DESTINATION') {
        throw new Error('حجم فایل از سقف قابل بازیابی در Bot API معمولی تلگرام بیشتر است (۲۰ مگابایت). برای فایل بزرگ‌تر باید زیرساخت Bot API مناسب پیکربندی شود.');
      }
      const uploadErrors: Record<string, string> = {
        FILE_ARCHIVE_FOLDER_INVALID: 'پوشهٔ انتخاب‌شده به این محموله یا صاحب کالا تعلق ندارد. پوشهٔ درست محموله را دوباره انتخاب کنید.',
        FILE_ARCHIVE_ROLE_FORBIDDEN: 'مجوز لازم برای آرشیو این فایل را ندارید.',
        FILE_ARCHIVE_DESTINATION_REQUIRED: 'مقصد انتخاب‌شده، آرشیو فایل تلگرام نیست؛ مقصد «mohsen» را در تنظیمات آرشیو بررسی کنید.',
        CHAT_NOT_ALLOWED: 'مقصد تلگرام فعال یا مجاز نیست. اتصال و مقصد آرشیو را بررسی کنید.',
        INVALID_FILE_ARCHIVE_INPUT: 'مشخصات آپلود کامل به سرور نرسید. صفحه را تازه‌سازی کنید و فایل را دوباره انتخاب کنید.',
        FILE_UPLOAD_JOB_CREATE_FAILED: 'سرور نتوانست صف آپلود را ثبت کند؛ هیچ تأیید معتبری از ارسال فایل دریافت نشد.',
        TELEGRAM_UPLOAD_FAILED: 'تلگرام فایل را نپذیرفت. اتصال ربات و دسترسی آن به چت «mohsen» را بررسی کنید.',
        FILE_UPLOAD_TELEGRAM_RECEIPT_SAVE_FAILED: 'تلگرام ممکن است فایل را دریافت کرده باشد، اما ثبت رسید سرور ناموفق بود؛ برای جلوگیری از تکرار، وضعیت آرشیو باید بازیابی شود.',
        FILE_ARCHIVE_METADATA_SAVE_FAILED: 'ارسال انجام شد، اما ثبت مشخصات فایل در وب‌سایت کامل نشد؛ وضعیت آرشیو باید بازیابی شود.',
      };
      throw new Error(uploadErrors[code] || `خطای آپلود: ${code}`);
    }
    return body;
  }

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `درخواست ناموفق بود (${response.status}).`);
  }
  return response;
}

export async function getFileArchiveDestination(): Promise<FileArchiveDestination> {
  const body = await authorizedRequest('/api/messenger/file-archive-destination');
  if (!body?.destination?.connectionId || !body?.destination?.chatId) {
    throw new Error('مقصد آرشیو تلگرام در دسترس نیست.');
  }
  return body.destination as FileArchiveDestination;
}

/**
 * Uploads bytes directly to the existing Telegram messenger gateway.
 * No OCR, extraction, antivirus/content scanning or AI processing is invoked
 * by this File Manager upload path. Access controls remain server-enforced.
 */
export async function getDefaultShipmentUploadFolder(shipmentId: string): Promise<{ id: string; shipment_id: string | null; client_id?: string | null; folder_type: string }> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('کاربر وارد نشده است.');
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', auth.user.id)
    .single();
  if (profileError || !profile?.organization_id) throw new Error('سازمان کاربر مشخص نیست.');
  const { data: folder, error } = await supabase
    .from('file_manager_folders')
    .select('id,shipment_id,client_id,folder_type')
    .eq('organization_id', profile.organization_id)
    .eq('shipment_id', shipmentId)
    .eq('folder_type', 'other')
    .maybeSingle();
  if (error) throw error;
  if (!folder) throw new Error('پوشه محموله آماده نیست؛ ابتدا محموله را ذخیره کنید یا ساختار پوشه‌ها را بررسی کنید.');
  return folder as { id: string; shipment_id: string | null; client_id?: string | null; folder_type: string };
}

export async function getDefaultClientUploadFolder(clientId: string): Promise<{ id: string; shipment_id: null; client_id: string; folder_type: string }> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('کاربر وارد نشده است.');
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', auth.user.id)
    .single();
  if (profileError || !profile?.organization_id) throw new Error('سازمان کاربر مشخص نیست.');
  const { data: folder, error } = await supabase
    .from('file_manager_folders')
    .select('id,shipment_id,client_id,folder_type')
    .eq('organization_id', profile.organization_id)
    .eq('client_id', clientId)
    .eq('folder_type', 'client')
    .is('shipment_id', null)
    .maybeSingle();
  if (error) throw error;
  if (!folder) throw new Error('پوشه صاحب کالا آماده نیست؛ ساختار پوشه‌ها را تازه‌سازی کنید.');
  return folder as { id: string; shipment_id: null; client_id: string; folder_type: string };
}

export async function uploadTelegramArchivedFile(
  file: File,
  input: {
    folderId: string;
    shipmentId?: string;
    documentType?: string;
    documentName?: string;
    tags?: string[];
    destination?: FileArchiveDestination;
    idempotencyKey?: string;
  },
): Promise<TelegramArchiveUpload> {
  if (file.size <= 0) throw new Error('فایل خالی است.');
  if (file.size > FILE_ARCHIVE_MAX_DOWNLOADABLE_BYTES) {
    throw new Error('برای اینکه فایل با Bot API معمولی تلگرام قابل بازیابی هم باشد، حجم هر فایل در حال حاضر حداکثر ۲۰ مگابایت است.');
  }

  const destination = input.destination || await getFileArchiveDestination();
  const idempotencyKey = input.idempotencyKey || await createTelegramArchiveIdempotencyKey(file, {
    folderId: input.folderId,
    ...(input.shipmentId ? { shipmentId: input.shipmentId } : {}),
    documentType: input.documentType,
    documentName: input.documentName,
    destination,
  });
  const query = new URLSearchParams({
    chatId: destination.chatId,
    folderId: input.folderId,
    ...(input.shipmentId ? { shipmentId: input.shipmentId } : {}),
    documentType: input.documentType || 'other',
    ...(input.documentName ? { documentName: input.documentName } : {}),
    tags: JSON.stringify((input.tags || []).slice(0, 20)),
  });

  const response = await authorizedRequest(
    `/api/messenger/uploads/${encodeURIComponent(destination.connectionId)}?${query.toString()}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Size': String(file.size),
        'Idempotency-Key': idempotencyKey,
      },
      body: file,
    },
  );
  if (!response?.fileAssetId) throw new Error('تلگرام فایل را تأیید نکرد؛ وضعیت ذخیره‌سازی قطعی نیست.');
  return response as TelegramArchiveUpload;
}

/**
 * Requests Telegram archival for an already-uploaded shipment document.
 * The browser keeps the Supabase Storage copy usable while this request runs;
 * the caller may fire-and-forget and retry safely because the gateway uses a
 * content-bound, durable upload idempotency ledger.
 */
export async function archiveShipmentDocumentInBackground(
  documentId: string,
  tags: string[] = [],
): Promise<TelegramArchiveUpload> {
  if (!documentId) throw new Error('شناسه سند معتبر نیست.');
  const body = await authorizedRequest(
    `/api/messenger/documents/${encodeURIComponent(documentId)}/archive`,
    {
      method: 'POST',
      body: JSON.stringify({ tags: tags.slice(0, 20) }),
    },
  );
  if (!body?.fileAssetId) {
    throw new Error('تلگرام رسید آرشیو سند را برنگرداند؛ نسخه امن سند در Storage حفظ شده است.');
  }
  return body as TelegramArchiveUpload;
}

export async function downloadTelegramArchivedFile(fileAssetId: string): Promise<Blob> {
  if (!fileAssetId) throw new Error('شناسه فایل معتبر نیست.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('نشست معتبر نیست؛ دوباره وارد وب‌سایت شوید.');
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  const apiKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;
  if (apiKey) headers.set('apikey', apiKey);
  const response = await fetch(`/api/messenger/files/${encodeURIComponent(fileAssetId)}/download`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const code = String(body?.error || 'FILE_DOWNLOAD_FAILED');
    if (code === 'SOURCE_FILE_OVER_DOWNLOAD_LIMIT') {
      throw new Error('بازیابی این فایل از Bot API معمولی تلگرام پشتیبانی نمی‌شود؛ برای فایل‌های بزرگ‌تر، Local Bot API Server لازم است.');
    }
    throw new Error(code);
  }
  return response.blob();
}

export const FILE_ARCHIVE_MAX_BYTES = FILE_ARCHIVE_MAX_DOWNLOADABLE_BYTES;
