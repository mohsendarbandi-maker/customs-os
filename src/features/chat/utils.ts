const BIDI_AND_CONTROL = /[\u0000-\u001f\u007f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

export const sanitizeFileName = (value: string): string => {
  const normalized = value.normalize('NFKC').replace(BIDI_AND_CONTROL, '');
  const safe = normalized
    .replace(/[\\/]/g, '-')
    .replace(/\.\.+/g, '.')
    .replace(/[^\p{L}\p{N}._,@=;:+!?()\- ]/gu, '')
    .trim();
  return (safe || 'فایل').slice(0, 180);
};

export const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[٠-٩]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[ـ]/g, '')
    .replace(/‌/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export const extractMentions = (text: string): string[] => {
  const ids = new Set<string>();
  const re = /@([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/gi;
  for (const match of text.matchAll(re)) ids.add(match[1]);
  return Array.from(ids);
};

export const formatFileSizeFa = (bytes: number): string => {
  if (bytes < 1024) return String(bytes.toLocaleString('fa-IR')) + ' بایت';
  if (bytes < 1024 * 1024) return String((bytes / 1024).toFixed(1).replace('.', '٫').toLocaleString('fa-IR')) + ' کیلوبایت';
  return String((bytes / (1024 * 1024)).toFixed(1).replace('.', '٫').toLocaleString('fa-IR')) + ' مگابایت';
};

export const toPersianDigits = (value: string | number): string =>
  String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

export const isProbablyImage = (mime: string): boolean => mime.startsWith('image/');
export const isProbablyVideo = (mime: string): boolean => mime.startsWith('video/');
export const isPdf = (mime: string): boolean => mime === 'application/pdf';

export type LocalFileCheck = {
  ok: boolean;
  reason?: string;
  detectedType?: 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'zip' | 'webm' | 'mp4' | 'unknown';
};

const starts = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((byte, index) => bytes[index] === byte);

export const inspectFileMagic = async (file: File): Promise<LocalFileCheck> => {
  const lowerName = file.name.toLowerCase();
  const blockedExtension = /\.(exe|dll|com|bat|cmd|ps1|js|mjs|cjs|vbs|vbe|jar|scr|msi|sh|php|py|rb|hta|svg|html?)$/i.test(lowerName);
  if (blockedExtension) return { ok: false, reason: 'این نوع فایل برای چت مجاز نیست.' };

  const buffer = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (starts(buffer, [0x25,0x50,0x44,0x46,0x2d])) return { ok: true, detectedType: 'pdf' };
  if (starts(buffer, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) return { ok: true, detectedType: 'png' };
  if (starts(buffer, [0xff,0xd8,0xff])) return { ok: true, detectedType: 'jpeg' };
  if (starts(buffer, [0x47,0x49,0x46,0x38])) return { ok: true, detectedType: 'gif' };
  if (starts(buffer, [0x52,0x49,0x46,0x46]) && new TextDecoder().decode(buffer.slice(8,12)) === 'WEBP') return { ok: true, detectedType: 'webp' };
  if (starts(buffer, [0x50,0x4b,0x03,0x04])) return { ok: true, detectedType: 'zip' };
  if (starts(buffer, [0x1a,0x45,0xdf,0xa3])) return { ok: true, detectedType: 'webm' };
  if (starts(buffer, [0x00,0x00,0x00]) && new TextDecoder().decode(buffer.slice(4,8)) === 'ftyp') return { ok: true, detectedType: 'mp4' };

  return { ok: false, reason: 'نوع واقعی فایل شناسایی نشد.', detectedType: 'unknown' };
};

export const compressImage = async (file: File): Promise<File> => {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;

  const bitmap = await createImageBitmap(file);
  const max = 1920;
  const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = canvas.getContext('2d');
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob || blob.size >= file.size) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
};
