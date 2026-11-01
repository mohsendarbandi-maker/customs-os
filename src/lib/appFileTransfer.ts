export type AppFileTransferTarget = 'chat' | 'pdf-studio' | 'file-manager';

type StoredFile = {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
};

type TransferRecord = {
  id: string;
  target: AppFileTransferTarget;
  createdAt: number;
  files: StoredFile[];
};

const DATABASE_NAME = 'customs-os-file-transfer';
const DATABASE_VERSION = 1;
const STORE_NAME = 'transfers';
const TRANSFER_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_TRANSFER_FILES = 50;

function openTransferDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('انتقال فایل در این مرورگر پشتیبانی نمی‌شود؛ مرورگر را به‌روز کنید.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('فضای موقت انتقال فایل باز نشد.'));
    request.onblocked = () => reject(new Error('پایگاه انتقال فایل در برگه دیگری در حال به‌روزرسانی است؛ برگه‌های تکراری را ببندید.'));
  });
}

function writeRecord(database: IDBDatabase, record: TransferRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(record);

    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const value = cursor.value as TransferRecord;
      if (value.id !== record.id && Date.now() - Number(value.createdAt || 0) > TRANSFER_TTL_MS) {
        cursor.delete();
      }
      cursor.continue();
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('ذخیره موقت فایل انجام نشد.'));
    transaction.onabort = () => reject(transaction.error || new Error('ذخیره موقت فایل لغو شد.'));
  });
}

export async function createAppFileTransfer(
  files: readonly File[],
  target: AppFileTransferTarget,
): Promise<string> {
  if (!files.length) throw new Error('هیچ فایلی برای انتقال انتخاب نشده است.');
  if (files.length > MAX_TRANSFER_FILES) throw new Error('در هر انتقال حداکثر ۵۰ فایل مجاز است.');

  const id = crypto.randomUUID();
  const record: TransferRecord = {
    id,
    target,
    createdAt: Date.now(),
    files: files.map((file) => ({
      name: file.name || 'attachment',
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified || Date.now(),
      blob: file.slice(0, file.size, file.type || 'application/octet-stream'),
    })),
  };

  const database = await openTransferDatabase();
  try {
    await writeRecord(database, record);
    return id;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'فضای موقت مرورگر برای انتقال فایل کافی نیست.';
    throw new Error(message.includes('Quota') || message.includes('quota')
      ? 'فضای موقت مرورگر کافی نیست؛ فایل‌های بزرگ‌تر را جداگانه منتقل کنید.'
      : message);
  } finally {
    database.close();
  }
}

export async function consumeAppFileTransfer(
  id: string,
  expectedTarget: AppFileTransferTarget,
): Promise<File[]> {
  if (!id) throw new Error('شناسه انتقال فایل معتبر نیست.');
  const database = await openTransferDatabase();
  let record: TransferRecord | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        const value = request.result as TransferRecord | undefined;
        if (!value) return;
        if (Date.now() - Number(value.createdAt || 0) > TRANSFER_TTL_MS) {
          store.delete(id);
          return;
        }
        if (value.target !== expectedTarget) return;
        if (!Array.isArray(value.files) || value.files.length === 0) {
          store.delete(id);
          return;
        }
        record = value;
        store.delete(id);
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('دریافت فایل انتقالی ناموفق بود.'));
      transaction.onabort = () => reject(transaction.error || new Error('دریافت فایل انتقالی لغو شد.'));
    });
  } finally {
    database.close();
  }

  if (!record) {
    throw new Error('فایل انتقالی پیدا نشد، منقضی شده یا برای این بخش ثبت نشده است؛ فایل را دوباره فوروارد کنید.');
  }

  return record.files.map((file) => new File(
    [file.blob],
    file.name,
    { type: file.type || file.blob.type || 'application/octet-stream', lastModified: file.lastModified || Date.now() },
  ));
}
