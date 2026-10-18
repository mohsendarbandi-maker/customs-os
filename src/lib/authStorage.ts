import type { SupportedStorage } from '@supabase/supabase-js';

const DB_NAME = 'customs-os-auth-fallback';
const STORE_NAME = 'auth_values';
const DB_VERSION = 1;
const memoryFallback = new Map<string, string>();
let dbPromise: Promise<IDBDatabase> | null = null;

const probeLocalStorage = () => {
  if (typeof window === 'undefined') return false;
  try {
    const key = '__customs_os_storage_probe__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

// Some iOS privacy/storage contexts can deny localStorage. The primary backend
// is still localStorage when writable; IndexedDB is a fallback, not a second
// routinely-written copy of refresh tokens.
let primaryStorageUnavailable = !probeLocalStorage();

const openFallbackDb = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open auth storage'));
      request.onblocked = () => reject(new Error('Auth storage upgrade is blocked'));
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
};

const readFallback = async (key: string): Promise<string | null> => {
  try {
    const db = await openFallbackDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => {
        const record = request.result as { key: string; value: string } | undefined;
        resolve(typeof record?.value === 'string' ? record.value : null);
      };
      request.onerror = () => reject(request.error || new Error('Unable to read auth storage'));
    });
  } catch {
    return memoryFallback.get(key) ?? null;
  }
};

const writeFallback = async (key: string, value: string): Promise<void> => {
  try {
    const db = await openFallbackDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ key, value });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to write auth storage'));
      transaction.onabort = () => reject(transaction.error || new Error('Auth storage write aborted'));
    });
    memoryFallback.delete(key);
  } catch {
    // Last-resort in-memory persistence prevents auth callbacks from throwing in
    // restricted browser modes. Only IndexedDB survives a full reload in fallback mode.
    memoryFallback.set(key, value);
  }
};

const removeFallback = async (key: string): Promise<void> => {
  memoryFallback.delete(key);
  try {
    const db = await openFallbackDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to remove auth storage'));
      transaction.onabort = () => reject(transaction.error || new Error('Auth storage removal aborted'));
    });
  } catch {
    // localStorage is removed independently when available; memory is already cleared.
  }
};

export const authStorage: SupportedStorage = {
  getItem: async (key) => {
    if (!primaryStorageUnavailable && typeof window !== 'undefined') {
      try {
        const value = window.localStorage.getItem(key);
        if (value !== null) return value;
      } catch {
        primaryStorageUnavailable = true;
      }
    }
    return readFallback(key);
  },

  setItem: async (key, value) => {
    if (!primaryStorageUnavailable && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(key, value);
        void removeFallback(key);
        return;
      } catch {
        primaryStorageUnavailable = true;
      }
    }
    await writeFallback(key, value);
  },

  removeItem: async (key) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(key);
      } catch {
        primaryStorageUnavailable = true;
      }
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // sessionStorage can be denied independently from localStorage.
      }
    }
    await removeFallback(key);
  },
};
