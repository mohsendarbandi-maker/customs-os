/*
 * Supabase Auth storage used by the browser client.
 * Root cause: the SDK's default persistence is localStorage-only. Safari privacy
 * modes, low-storage conditions, or storage restrictions can make localStorage
 * throw; IndexedDB is the persistent same-origin fallback, never sessionStorage.
 */
const AUTH_DB_NAME = 'customs-os-auth-storage';
const AUTH_DB_VERSION = 1;
const AUTH_STORE_NAME = 'auth_kv';

let databasePromise: Promise<IDBDatabase> | null = null;

function openAuthDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser context.'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTH_DB_NAME, AUTH_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTH_STORE_NAME)) {
        db.createObjectStore(AUTH_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open auth storage.'));
    request.onblocked = () => reject(new Error('Auth storage upgrade is blocked by another tab.'));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });

  return databasePromise;
}

async function readFallback(key: string): Promise<string | null> {
  const db = await openAuthDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUTH_STORE_NAME, 'readonly');
    const request = transaction.objectStore(AUTH_STORE_NAME).get(key);
    request.onsuccess = () => {
      const row = request.result as { key: string; value: string } | undefined;
      resolve(typeof row?.value === 'string' ? row.value : null);
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to read auth storage.'));
  });
}

async function writeFallback(key: string, value: string): Promise<void> {
  const db = await openAuthDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUTH_STORE_NAME, 'readwrite');
    transaction.objectStore(AUTH_STORE_NAME).put({ key, value });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to write auth storage.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Auth storage write was aborted.'));
  });
}

async function removeFallback(key: string): Promise<void> {
  const db = await openAuthDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUTH_STORE_NAME, 'readwrite');
    transaction.objectStore(AUTH_STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to delete auth storage.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Auth storage delete was aborted.'));
  });
}

export const persistentAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) return value;
    } catch {
      // Safari may deny localStorage; use IndexedDB below.
    }

    try {
      return await readFallback(key);
    } catch (error) {
      console.warn('[Auth storage] Persistent read failed; keeping the session in memory if possible.', error);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      window.localStorage.setItem(key, value);
      // Remove any older fallback copy after a successful primary write, so a
      // later localStorage miss cannot restore an obsolete refresh token.
      void removeFallback(key).catch(() => undefined);
      return;
    } catch {
      // Continue to the same-origin persistent fallback.
    }

    try {
      await writeFallback(key, value);
    } catch (error) {
      // Don't convert a successful sign-in into an exception solely because
      // both browser persistence APIs are blocked. The SDK can still hold memory state.
      console.warn('[Auth storage] Neither localStorage nor IndexedDB accepted the session.', error);
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Still attempt to delete the fallback copy.
    }
    try {
      await removeFallback(key);
    } catch (error) {
      console.warn('[Auth storage] Could not clear the IndexedDB fallback.', error);
    }
  },
};
