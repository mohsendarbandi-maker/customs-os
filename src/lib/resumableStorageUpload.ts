import { supabase } from './supabase';

export const RESUMABLE_UPLOAD_THRESHOLD = 6 * 1024 * 1024;
const RESUMABLE_UPLOAD_CHUNK_BYTES = 6 * 1024 * 1024;

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, Math.min(start + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function storageApiBaseUrl(): string {
  const env = (import.meta as any).env;
  const local = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return (local ? String(env.VITE_SUPABASE_URL || '') : window.location.origin).replace(/\/$/, '');
}

/**
 * Uploads a private Storage object using the TUS resumable protocol.
 * Browser chunks stay on the site's first-party Worker in production.
 */
export async function uploadResumableStorageFile(
  bucketName: string,
  objectName: string,
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error('نشست معتبر نیست؛ دوباره وارد وب‌سایت شوید.');
  const apiKey = String((import.meta as any).env.VITE_SUPABASE_ANON_KEY || '');
  if (!apiKey) throw new Error('کلید عمومی Storage در تنظیمات وب‌سایت موجود نیست.');

  const baseUrl = storageApiBaseUrl();
  const endpoint = new URL('/storage/v1/upload/resumable', baseUrl).toString();
  const metadata = [
    ['bucketName', bucketName],
    ['objectName', objectName],
    ['contentType', file.type || 'application/octet-stream'],
    ['cacheControl', '3600'],
  ].map(([key, value]) => key + ' ' + base64Utf8(value)).join(',');
  const create = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + accessToken,
      apikey: apiKey,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(file.size),
      'Upload-Metadata': metadata,
    },
    cache: 'no-store',
  });
  if (create.status !== 201) {
    const detail = (await create.text().catch(() => '')).slice(0, 240);
    throw new Error(('ایجاد آپلود قابل‌ادامه ناموفق بود (' + create.status + ') ' + detail).trim());
  }
  const location = create.headers.get('Location');
  if (!location) throw new Error('ذخیره‌سازی نشانی ادامهٔ آپلود را برنگرداند.');
  const uploadUrl = new URL(location, endpoint);
  const configuredBase = new URL(baseUrl);
  if (uploadUrl.pathname.startsWith('/upload/resumable/')) uploadUrl.pathname = '/storage/v1' + uploadUrl.pathname;
  if (!uploadUrl.pathname.startsWith('/storage/v1/upload/resumable/')) {
    throw new Error('مسیر ادامهٔ آپلود از سوی ذخیره‌سازی معتبر نیست.');
  }
  uploadUrl.protocol = configuredBase.protocol;
  uploadUrl.host = configuredBase.host;

  const commonHeaders = {
    authorization: 'Bearer ' + accessToken,
    apikey: apiKey,
    'Tus-Resumable': '1.0.0',
  };
  const readOffset = async (): Promise<number> => {
    const response = await fetch(uploadUrl.toString(), {
      method: 'HEAD', headers: commonHeaders, cache: 'no-store',
    });
    if (!response.ok) throw new Error('دریافت وضعیت ادامهٔ آپلود ناموفق بود (' + response.status + ').');
    const offset = Number(response.headers.get('Upload-Offset'));
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) {
      throw new Error('وضعیت بایت‌های آپلودشده معتبر نیست.');
    }
    return offset;
  };
  const patchChunk = (offset: number, chunk: Blob): Promise<number> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PATCH', uploadUrl.toString(), true);
    xhr.setRequestHeader('authorization', commonHeaders.authorization);
    xhr.setRequestHeader('apikey', commonHeaders.apikey);
    xhr.setRequestHeader('Tus-Resumable', commonHeaders['Tus-Resumable']);
    xhr.setRequestHeader('Upload-Offset', String(offset));
    xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
    xhr.timeout = 60000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && file.size > 0) {
        onProgress?.(Math.min(99, Math.floor(((offset + event.loaded) / file.size) * 100)));
      }
    };
    xhr.onerror = () => reject(new Error('ارتباط هنگام ارسال بخشی از فایل قطع شد.'));
    xhr.ontimeout = () => reject(new Error('ارسال بخشی از فایل بیش از حد طول کشید.'));
    xhr.onload = () => {
      if (xhr.status !== 204) {
        reject(new Error('ارسال بخشی از فایل ناموفق بود (' + xhr.status + ').'));
        return;
      }
      const nextOffset = Number(xhr.getResponseHeader('Upload-Offset'));
      resolve(Number.isSafeInteger(nextOffset) && nextOffset >= offset ? nextOffset : offset + chunk.size);
    };
    xhr.send(chunk);
  });

  let offset = 0;
  let retries = 0;
  const retryDelays = [700, 1500, 3000, 5000, 8000];
  onProgress?.(0);
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(offset + RESUMABLE_UPLOAD_CHUNK_BYTES, file.size));
    try {
      const nextOffset = await patchChunk(offset, chunk);
      if (nextOffset <= offset || nextOffset > file.size) throw new Error('ذخیره‌سازی پیشرفت نامعتبر برگرداند.');
      offset = nextOffset;
      retries = 0;
      onProgress?.(Math.min(99, Math.floor((offset / file.size) * 100)));
    } catch (uploadError) {
      retries += 1;
      if (retries > retryDelays.length) throw uploadError;
      await new Promise((resolve) => setTimeout(resolve, retryDelays[retries - 1]));
      // HEAD avoids repeating bytes when a PATCH reached Storage but its reply was lost.
      offset = await readOffset();
      onProgress?.(Math.min(99, Math.floor((offset / file.size) * 100)));
    }
  }
  onProgress?.(100);
}
