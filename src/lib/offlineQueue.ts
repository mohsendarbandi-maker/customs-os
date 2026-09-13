import type { SupabaseClient } from '@supabase/supabase-js';

type QueuedRpc = {
  id: string;
  createdAt: string;
  userId: string;
  functionName: string;
  args: Record<string, unknown>;
  attempts: number;
  lastError?: string;
};

type QueueListener = (items: QueuedRpc[]) => void;

const DB_NAME = 'customs-os-offline';
const STORE_NAME = 'rpc_queue';
const DB_VERSION = 2;

// Only mutations that are safe to replay without creating duplicate business events.
// Maritime tracking is deliberately excluded because every execution inserts a new event.
// Login/session RPCs, read RPCs, and case creation are also excluded.
export const OFFLINE_QUEUEABLE_RPCS = new Set([
  'attach_registration_order',
  'update_case_operational_data',
  'update_shipment_maritime_data',
]);

let dbPromise: Promise<IDBDatabase> | null = null;
let supabaseClient: SupabaseClient | null = null;
const listeners = new Set<QueueListener>();
let flushing = false;

export const attachSupabaseClient = (client: SupabaseClient) => {
  supabaseClient = client;
};

const storageAvailable = () => typeof indexedDB !== 'undefined';
const makeId = () => `${Date.now()}-${crypto.randomUUID()}`;

const currentUserId = async () => {
  if (!supabaseClient) return null;
  try {
    const { data } = await supabaseClient.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
};

const openDb = () => {
  if (!storageAvailable()) return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('userId', 'userId', { unique: false });
      } else {
        const store = request.transaction?.objectStore(STORE_NAME);
        if (store && !store.indexNames.contains('userId')) {
          store.createIndex('userId', 'userId', { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
  });
  return dbPromise;
};

const emit = async () => {
  try {
    const items = await listQueue();
    listeners.forEach((listener) => listener(items));
  } catch {
    // Storage failure must never break the application UI.
  }
};

export const listQueue = async (): Promise<QueuedRpc[]> => {
  const userId = await currentUserId();
  if (!userId) return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const items = (request.result as QueuedRpc[])
        .filter((item) => item.userId === userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      resolve(items);
    };
    request.onerror = () => reject(request.error || new Error('Unable to read offline queue'));
  });
};

const putQueueItem = async (item: QueuedRpc) => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Unable to write offline queue'));
  });
};

const deleteQueueItem = async (id: string) => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Unable to delete offline queue item'));
  });
};

export const subscribeOfflineQueue = (listener: QueueListener) => {
  listeners.add(listener);
  void emit();
  return () => listeners.delete(listener);
};

export const enqueueRpc = async (functionName: string, args: Record<string, unknown>) => {
  if (!OFFLINE_QUEUEABLE_RPCS.has(functionName)) {
    throw new Error(`RPC is not eligible for offline queue: ${functionName}`);
  }
  const userId = await currentUserId();
  if (!userId) {
    throw new Error('Authenticated user required for offline queue');
  }
  const item: QueuedRpc = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    userId,
    functionName,
    args,
    attempts: 0,
  };
  await putQueueItem(item);
  await emit();
  return item.id;
};

const isNetworkError = (error: unknown) => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return !navigator.onLine || /network|fetch|failed to fetch|offline|timeout|connection/i.test(message);
};

export const flushOfflineQueue = async () => {
  if (flushing || !navigator.onLine || !supabaseClient) return;
  const userId = await currentUserId();
  if (!userId) return;
  flushing = true;
  try {
    const items = await listQueue();
    for (const item of items) {
      if (item.userId !== userId) continue;
      if (!OFFLINE_QUEUEABLE_RPCS.has(item.functionName)) {
        await deleteQueueItem(item.id);
        continue;
      }
      try {
        const { error } = await supabaseClient.rpc(item.functionName, item.args);
        if (error) {
          item.attempts += 1;
          item.lastError = error.message;
          await putQueueItem(item);
          if (isNetworkError(error)) break;
          continue;
        }
        await deleteQueueItem(item.id);
      } catch (error) {
        item.attempts += 1;
        item.lastError = String((error as any)?.message || error);
        await putQueueItem(item);
        if (isNetworkError(error)) break;
      }
    }
  } finally {
    flushing = false;
    await emit();
  }
};

export const startOfflineQueue = () => {
  const onOnline = () => void flushOfflineQueue();
  window.addEventListener('online', onOnline);
  void flushOfflineQueue();
  const timer = window.setInterval(() => void flushOfflineQueue(), 30000);
  return () => {
    window.removeEventListener('online', onOnline);
    window.clearInterval(timer);
  };
};

export const rpcWithOfflineQueue = async (
  functionName: string,
  args: Record<string, unknown>,
  options?: { queueWhenOffline?: boolean }
) => {
  if (!supabaseClient) throw new Error('Supabase client is not attached');
  const queueWhenOffline = options?.queueWhenOffline ?? OFFLINE_QUEUEABLE_RPCS.has(functionName);
  const queueable = OFFLINE_QUEUEABLE_RPCS.has(functionName);

  if (queueWhenOffline && queueable && !navigator.onLine) {
    const id = await enqueueRpc(functionName, args);
    return { data: null, error: null, queued: true as const, queueId: id };
  }

  const result = await supabaseClient.rpc(functionName, args);
  if (!result.error) return { ...result, queued: false as const };

  if (queueWhenOffline && queueable && isNetworkError(result.error)) {
    const id = await enqueueRpc(functionName, args);
    return { data: null, error: null, queued: true as const, queueId: id };
  }
  return { ...result, queued: false as const };
};
