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

  const response = await fetch(path, {
    ...init,
    headers,
    cache: 'no-store',
  });
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
      throw new Error(code);
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
        'Idempotency-Key': input.idempotencyKey || crypto.randomUUID(),
      },
      body: file,
    },
  );
  if (!response?.fileAssetId) throw new Error('تلگرام فایل را تأیید نکرد؛ وضعیت ذخیره‌سازی قطعی نیست.');
  return response as TelegramArchiveUpload;
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
