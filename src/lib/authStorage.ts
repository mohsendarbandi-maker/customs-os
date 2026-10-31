/**
 * Durable Supabase Auth storage.
 *
 * localStorage remains the primary store for cross-tab compatibility. The exact
 * same opaque session value is mirrored to IndexedDB so Safari storage access
 * restrictions/quota failures can recover without discarding a valid refresh token.
 * Explicit removeItem clears all stores to prevent a signed-out session being restored.
 */
export type AuthSessionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type LocalStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type StorageDependencies = {
  getLocalStorage?: () => LocalStorageLike | undefined;
  getIndexedDB?: () => IDBFactory | undefined;
};

const DATABASE_NAME = 'customs-os-auth-fallback-v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'sessions';

export function createAuthStorageAdapter(dependencies: StorageDependencies = {}): AuthSessionStorage {
  const memory = new Map<string, string>();
  let databasePromise: Promise<IDBDatabase | null> | null = null;
  const indexedDBQueues = new Map<string, Promise<unknown>>();

  const enqueueIndexedDB = <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = indexedDBQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    indexedDBQueues.set(key, next);
    void next.then(
      () => { if (indexedDBQueues.get(key) === next) indexedDBQueues.delete(key); },
      () => { if (indexedDBQueues.get(key) === next) indexedDBQueues.delete(key); },
    );
    return next;
  };

  const getLocalStorage =
    dependencies.getLocalStorage ??
    (() => (typeof window === 'undefined' ? undefined : window.localStorage));
  const getIndexedDB =
    dependencies.getIndexedDB ??
    (() => (typeof indexedDB === 'undefined' ? undefined : indexedDB));

  const openDatabase = (): Promise<IDBDatabase | null> => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (database: IDBDatabase | null) => {
        if (settled) {
          database?.close();
          return;
        }
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve(database);
      };

      try {
        const factory = getIndexedDB();
        if (!factory) {
          finish(null);
          return;
        }
        const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
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
    return databasePromise;
  };

  const readIndexedDB = async (key: string): Promise<string | null> => {
    const db = await openDatabase();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => {
          const value = request.result?.value;
          resolve(typeof value === 'string' ? value : null);
        };
        request.onerror = () => resolve(null);
        transaction.onabort = () => resolve(null);
        transaction.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  };

  const writeIndexedDB = async (key: string, value: string): Promise<boolean> => {
    const db = await openDatabase();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put({ key, value });
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  };

  const removeIndexedDB = async (key: string): Promise<void> => {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  };

  return {
    async getItem(key) {
      try {
        const storage = getLocalStorage();
        const value = storage?.getItem(key);
        if (value !== null && value !== undefined) {
          memory.set(key, value);
          // Do not mirror on reads: racing tab reads can otherwise write a stale
          // refresh token over a newer token in the asynchronous fallback store.
          return value;
        }
      } catch {
        // Safari may deny localStorage access in restricted contexts; try IndexedDB.
      }

      const durableFallback = await enqueueIndexedDB(key, () => readIndexedDB(key));
      if (durableFallback !== null) {
        memory.set(key, durableFallback);
        try {
          getLocalStorage()?.setItem(key, durableFallback);
        } catch {
          // IndexedDB remains the durable session store for this context.
        }
        return durableFallback;
      }
      return memory.get(key) ?? null;
    },

    async setItem(key, value) {
      memory.set(key, value);
      let localStorageWriteSucceeded = false;
      try {
        const storage = getLocalStorage();
        if (storage) {
          storage.setItem(key, value);
          localStorageWriteSucceeded = true;
        }
      } catch {
        // Try IndexedDB if localStorage is disabled/quota-limited.
      }

      const indexedDBWriteSucceeded = await enqueueIndexedDB(key, () => writeIndexedDB(key, value));
      if (!localStorageWriteSucceeded && !indexedDBWriteSucceeded) {
        // Keep the session usable until this page closes, while preserving neither
        // a false "durable" guarantee nor a silent logout on the next navigation.
        memory.set(key, value);
      }
    },

    async removeItem(key) {
      memory.delete(key);
      try {
        getLocalStorage()?.removeItem(key);
      } catch {
        // Continue clearing the other session stores.
      }
      await enqueueIndexedDB(key, () => removeIndexedDB(key));
    },
  };
}

export const authSessionStorage = createAuthStorageAdapter();
