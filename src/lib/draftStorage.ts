/**
 * Durable, per-key form draft storage. localStorage remains the fast synchronous
 * copy; IndexedDB mirrors the JSON payload and is used to restore it when Safari
 * denies or clears localStorage unexpectedly.
 *
 * Draft keys must include the authenticated user ID (and form/entity identifier).
 * No API tokens or server-authoritative records belong in this store.
 */
const DATABASE_NAME = 'customs-os-form-drafts-v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'drafts';

type DraftRecord = { key: string; value: string; updatedAt: number };

function parseDraft(value: string | null): unknown | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getLocalStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (db: IDBDatabase | null) => {
      if (done) {
        db?.close();
        return;
      }
      done = true;
      if (timeout) clearTimeout(timeout);
      resolve(db);
    };
    try {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      timeout = setTimeout(() => finish(null), 1500);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        finish(db);
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

async function readIndexedDB(key: string): Promise<string | null> {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => {
        const value = (request.result as DraftRecord | undefined)?.value;
        resolve(typeof value === 'string' ? value : null);
      };
      request.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
      transaction.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeIndexedDB(key: string, value: string): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const record: DraftRecord = { key, value, updatedAt: Date.now() };
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function removeIndexedDB(key: string): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Reads localStorage first, then restores a copy from IndexedDB if needed. */
export async function readDraftValue(key: string): Promise<unknown | null> {
  if (!key) return null;
  try {
    const raw = getLocalStorage()?.getItem(key) ?? null;
    const parsed = parseDraft(raw);
    if (parsed !== null && raw !== null) {
      void writeIndexedDB(key, raw);
      return parsed;
    }
  } catch {
    // Continue to IndexedDB if localStorage access is blocked.
  }

  const fallback = await readIndexedDB(key);
  const parsed = parseDraft(fallback);
  if (parsed !== null && fallback !== null) {
    try {
      getLocalStorage()?.setItem(key, fallback);
    } catch {
      // IndexedDB still contains the recovered draft.
    }
    return parsed;
  }
  return null;
}

/** True when at least one durable browser store accepted the draft. */
export async function writeDraftValue(key: string, value: unknown): Promise<boolean> {
  if (!key) return false;
  let raw: string;
  try {
    raw = JSON.stringify(value);
    if (!raw || raw === 'undefined') return false;
  } catch {
    return false;
  }

  let localStorageSaved = false;
  try {
    const local = getLocalStorage();
    if (local) {
      local.setItem(key, raw);
      localStorageSaved = true;
    }
  } catch {
    // IndexedDB is the fallback when Safari blocks localStorage.
  }

  const indexedDBSaved = await writeIndexedDB(key, raw);
  return localStorageSaved || indexedDBSaved;
}

export async function removeDraftValue(key: string): Promise<boolean> {
  if (!key) return false;
  let localStorageCleared = false;
  try {
    const local = getLocalStorage();
    if (local) {
      local.removeItem(key);
      localStorageCleared = true;
    }
  } catch {
    // Continue clearing IndexedDB.
  }
  const indexedDBCleared = await removeIndexedDB(key);
  return localStorageCleared || indexedDBCleared;
}
