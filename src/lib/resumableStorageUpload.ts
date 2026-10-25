import * as tus from 'tus-js-client';
import { supabase } from './supabase';

export const RESUMABLE_UPLOAD_THRESHOLD = 6 * 1024 * 1024;

function resumableUploadEndpoint(): string {
  const env = (import.meta as any).env;
  const configuredUrl = String(env.VITE_SUPABASE_URL || '').trim();
  const local = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (local && configuredUrl) {
    const directStorage = new URL(configuredUrl);
    directStorage.hostname = directStorage.hostname.replace(/\.supabase\.co$/i, '.storage.supabase.co');
    directStorage.pathname = '/storage/v1/upload/resumable';
    directStorage.search = '';
    directStorage.hash = '';
    return directStorage.toString();
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : configuredUrl;
  return new URL('/storage/v1/upload/resumable', origin).toString();
}

export async function uploadResumableStorageFile(
  bucketName: string,
  objectName: string,
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('نشست معتبر نیست؛ دوباره وارد وب‌سایت شوید.');
  const apiKey = String((import.meta as any).env.VITE_SUPABASE_ANON_KEY || '');
  if (!apiKey) throw new Error('کلید عمومی Storage در تنظیمات وب‌سایت موجود نیست.');

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const upload = new tus.Upload(file, {
        endpoint: resumableUploadEndpoint(),
        headers: {
          Authorization: 'Bearer ' + data.session!.access_token,
          apikey: apiKey,
          'x-upsert': 'false',
        },
        chunkSize: RESUMABLE_UPLOAD_THRESHOLD,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        storeFingerprintForResuming: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName,
          objectName,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600',
        },
        onProgress(bytesUploaded, bytesTotal) {
          const percentage = bytesTotal > 0 ? Math.floor(bytesUploaded / bytesTotal * 100) : 0;
          onProgress?.(Math.max(0, Math.min(100, percentage)));
        },
        onError(error) {
          fail(error);
        },
        onSuccess() {
          onProgress?.(100);
          if (settled) return;
          settled = true;
          resolve();
        },
      });
      void upload.findPreviousUploads().then((previousUploads) => {
        const previous = previousUploads.find((item) =>
          item.metadata?.bucketName === bucketName && item.metadata?.objectName === objectName,
        );
        if (previous) upload.resumeFromPreviousUpload(previous);
        upload.start();
      }).catch((error: unknown) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
