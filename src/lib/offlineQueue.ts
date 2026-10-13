import type { SupabaseClient } from '@supabase/supabase-js';
import { makeClientId } from './clientId';

export type QueuedRpcState = 'queued' | 'sending' | 'failed';

export type QueuedRpc = {
  id: string;
  createdAt: string;
  userId: string;
  functionName: string;
  args: Record<string, unknown>;
  attempts: number;
  lastError?: string;
  lastErrorCode?: string;
  nextAttemptAt?: number;
  state?: QueuedRpcState;
};

type QueueListener = (items: QueuedRpc[]) => void;

const DB_NAME = 'customs-os-offline';
const STORE_NAME = 'rpc_queue';
const QUERY_CACHE_STORE_NAME = 'query_cache';
const DB_VERSION = 4;
const MAX_QUERY_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_QUERY_CACHE_ENTRIES_PER_SCOPE = 60;
export const CHAT_RPC = 'chat_insert_message';
export const CHAT_MAX_AUTO_RETRIES = 8;

export const OFFLINE_QUEUEABLE_RPCS = new Set([
  'attach_registration_order',
  'update_case_operational_data',
  'update_shipment_maritime_data',
  'create_operational_reminder',
  CHAT_RPC,
]);

let dbPromise: Promise<IDBDatabase> | null = null;
let supabaseClient: SupabaseClient | null = null;
const listeners = new Set<QueueListener>();
let flushing = false;
let chatFlushTimer: number | null = null;
let stopOfflineQueue: (() => void) | null = null;

export const attachSupabaseClient = (client: SupabaseClient) => {
  supabaseClient = client;
};

const storageAvailable = () => typeof indexedDB !== 'undefined';
const makeId = () => `${Date.now()}-${makeClientId()}`;

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
      const transaction = request.transaction;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('state', 'state', { unique: false });
        store.createIndex('nextAttemptAt', 'nextAttemptAt', { unique: false });
      } else {
        const existingStore = transaction?.objectStore(STORE_NAME);
        if (existingStore) {
          if (!existingStore.indexNames.contains('userId')) existingStore.createIndex('userId', 'userId', { unique: false });
          if (!existingStore.indexNames.contains('state')) existingStore.createIndex('state', 'state', { unique: false });
          if (!existingStore.indexNames.contains('nextAttemptAt')) existingStore.createIndex('nextAttemptAt', 'nextAttemptAt', { unique: false });
        }
      }
      // Keep offline data and the existing RPC outbox in the same versioned database.
      if (!db.objectStoreNames.contains(QUERY_CACHE_STORE_NAME)) {
        db.createObjectStore(QUERY_CACHE_STORE_NAME, { keyPath: 'cacheKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
  });
  return dbPromise;
};

type OfflineQueryCacheRecord<T> = {
  cacheKey: string;
  namespace: string;
  userId: string;
  organizationId: string;
  updatedAt: number;
  payload: T;
};

export type OfflineQueryCacheValue<T> = { payload: T; updatedAt: number };

const makeQueryCacheKey = (namespace: string, userId: string, organizationId: string) =>
  JSON.stringify([userId, organizationId, namespace]);

/**
 * Persist non-secret read snapshots for offline display. Keys are partitioned
 * by authenticated user and organization; no session/token is stored in cache.
 */
export const saveOfflineQueryCache = async <T,>(
  namespace: string,
  userId: string | null | undefined,
  organizationId: string | null | undefined,
  payload: T,
): Promise<boolean> => {
  if (!namespace || !userId || !organizationId) return false;
  if ((await currentUserId()) !== userId) return false;
  const db = await openDb();
  const record: OfflineQueryCacheRecord<T> = {
    cacheKey: makeQueryCacheKey(namespace, userId, organizationId),
    namespace,
    userId,
    organizationId,
    updatedAt: Date.now(),
    payload,
  };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUERY_CACHE_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(QUERY_CACHE_STORE_NAME);
    store.put(record);
    const listRequest = store.getAll();
    listRequest.onsuccess = () => {
      const now = Date.now();
      const entries = listRequest.result as OfflineQueryCacheRecord<unknown>[];
      const expired = entries.filter((entry) => !Number.isFinite(entry.updatedAt) || now - entry.updatedAt > MAX_QUERY_CACHE_AGE_MS);
      expired.forEach((entry) => store.delete(entry.cacheKey));
      const sameScope = entries
        .filter((entry) => entry.userId === userId && entry.organizationId === organizationId && now - entry.updatedAt <= MAX_QUERY_CACHE_AGE_MS)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      sameScope.slice(MAX_QUERY_CACHE_ENTRIES_PER_SCOPE).forEach((entry) => store.delete(entry.cacheKey));
    };
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error('Unable to save offline query cache'));
    transaction.onabort = () => reject(transaction.error || new Error('Offline query cache write aborted'));
  });
};

export const readOfflineQueryCache = async <T,>(
  namespace: string,
  userId: string | null | undefined,
  organizationId: string | null | undefined,
): Promise<OfflineQueryCacheValue<T> | null> => {
  if (!namespace || !userId || !organizationId) return null;
  if ((await currentUserId()) !== userId) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(QUERY_CACHE_STORE_NAME, 'readonly')
      .objectStore(QUERY_CACHE_STORE_NAME)
      .get(makeQueryCacheKey(namespace, userId, organizationId));
    request.onsuccess = () => {
      const value = request.result as OfflineQueryCacheRecord<T> | undefined;
      if (
        !value ||
        value.userId !== userId ||
        value.organizationId !== organizationId ||
        !Number.isFinite(value.updatedAt) ||
        Date.now() - value.updatedAt > MAX_QUERY_CACHE_AGE_MS
      ) {
        resolve(null);
        return;
      }
      resolve({ payload: value.payload, updatedAt: value.updatedAt });
    };
    request.onerror = () => reject(request.error || new Error('Unable to read offline query cache'));
  });
};

const emit = async () => {
  try {
    const items = await listQueue();
    listeners.forEach((listener) => listener(items));
  } catch {
    // Storage failures never break the messenger.
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
        .map((item) => ({
          ...item,
          state: item.state ?? 'queued',
          nextAttemptAt: item.nextAttemptAt ?? 0,
        }))
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

export const isChatQueueItem = (item: QueuedRpc) =>
  item.functionName === CHAT_RPC &&
  typeof item.args.client_uuid === 'string' &&
  typeof item.args.p_conversation_id === 'string';

const scheduleNextChatFlush = () => {
  if (typeof window === 'undefined' || !navigator.onLine || chatFlushTimer !== null) return;
  void listQueue().then((items) => {
    const next = items
      .filter((item) => isChatQueueItem(item) && item.state === 'queued')
      .map((item) => item.nextAttemptAt ?? 0)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)[0];

    if (next === undefined) return;

    const delay = Math.max(0, Math.min(next - Date.now(), 60000));
    chatFlushTimer = window.setTimeout(() => {
      chatFlushTimer = null;
      void flushOfflineQueue();
    }, delay);
  }).catch(() => {});
};

export const chatClientUuid = (item: QueuedRpc) =>
  isChatQueueItem(item) ? String(item.args.client_uuid) : null;

export const retryDelayMs = (attempts: number) => {
  const safe = Math.max(0, Math.min(attempts, CHAT_MAX_AUTO_RETRIES));
  return Math.min(30000, 1000 * (2 ** safe));
};

export type ChatErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'PERMISSION_ERROR'
  | 'VALIDATION_ERROR'
  | 'SERVER_ERROR'
  | 'RATE_LIMIT'
  | 'UNKNOWN';

export const classifyChatError = (error: unknown): ChatErrorCode => {
  const value = error as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof value?.code === 'string' ? value.code.toUpperCase() : '';
  const status = typeof value?.status === 'number' ? value.status : undefined;
  const message = typeof value?.message === 'string' ? value.message.toLowerCase() : '';

  if (code === 'PGRST301' || status === 401 || /jwt|session|not authenticated|احراز هویت|نشست/.test(message)) {
    return 'AUTH_ERROR';
  }
  if (code === '42501' || status === 403 || /permission|forbidden|not allowed|دسترسی|مجاز نیست/.test(message)) {
    return 'PERMISSION_ERROR';
  }
  if (status === 429 || /rate limit|too many requests|محدودیت درخواست/.test(message)) {
    return 'RATE_LIMIT';
  }
  if (
    code === '22P02' ||
    code === '23514' ||
    status === 400 ||
    /invalid|validation|نامعتبر|الزامی|طولانی‌تر/.test(message)
  ) {
    return 'VALIDATION_ERROR';
  }
  if (status !== undefined && status >= 500) return 'SERVER_ERROR';
  const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (/network|fetch|failed to fetch|offline|timeout|timed out|connection|اتصال/.test(message) || browserOffline) {
    return 'NETWORK_ERROR';
  }
  return 'UNKNOWN';
};

const isRetryableChatError = (code: ChatErrorCode) =>
  code === 'NETWORK_ERROR' || code === 'SERVER_ERROR' || code === 'RATE_LIMIT';

const isNetworkError = (error: unknown) => classifyChatError(error) === 'NETWORK_ERROR';

export const enqueueRpc = async (
  functionName: string,
  args: Record<string, unknown>,
  options?: Partial<Pick<QueuedRpc, 'state' | 'attempts' | 'lastError' | 'lastErrorCode' | 'nextAttemptAt'>>,
) => {
  if (!OFFLINE_QUEUEABLE_RPCS.has(functionName)) {
    throw new Error(`RPC is not eligible for offline queue: ${functionName}`);
  }
  const userId = await currentUserId();
  if (!userId) throw new Error('Authenticated user required for offline queue');

  const item: QueuedRpc = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    userId,
    functionName,
    args,
    attempts: options?.attempts ?? 0,
    state: options?.state ?? 'queued',
    lastError: options?.lastError,
    lastErrorCode: options?.lastErrorCode,
    nextAttemptAt: options?.nextAttemptAt ?? Date.now(),
  };
  await putQueueItem(item);
  await emit();
  scheduleNextChatFlush();
  return item.id;
};

export const persistFailedChatRpc = async (args: Record<string, unknown>, error: unknown) => {
  const code = classifyChatError(error);
  return enqueueRpc(CHAT_RPC, args, {
    state: 'failed',
    attempts: 1,
    lastError: String((error as any)?.message || error || 'ارسال انجام نشد'),
    lastErrorCode: code,
    nextAttemptAt: Number.MAX_SAFE_INTEGER,
  });
};

export const removeQueuedRpc = async (id: string) => {
  const userId = await currentUserId();
  if (!userId) return;
  const items = await listQueue();
  if (!items.some((item) => item.id === id && item.userId === userId)) return;
  await deleteQueueItem(id);
  await emit();
};

export const sendChatRpc = async (
  args: Record<string, unknown>,
  options: { durable?: boolean } = {},
): Promise<{ data: unknown; queued: boolean; queueId: string }> => {
  if (!supabaseClient) throw new Error('Supabase client is not attached');
  const userId = await currentUserId();
  if (!userId) throw new Error('ابتدا وارد سیستم شوید.');

  if (options.durable === false) {
    const result = await supabaseClient.rpc(CHAT_RPC, args);
    if (result.error) throw Object.assign(new Error(result.error.message), result.error);
    return { data: result.data, queued: false, queueId: '' };
  }

  const queueId = await enqueueRpc(CHAT_RPC, args, {
    state: navigator.onLine ? 'sending' : 'queued',
    nextAttemptAt: Date.now(),
  });

  if (!navigator.onLine) return { data: null, queued: true, queueId };

  let result;
  try {
    result = await supabaseClient.rpc(CHAT_RPC, args);
  } catch (error) {
    const code = classifyChatError(error);
    const item = (await listQueue()).find((value) => value.id === queueId);
    if (item) {
      item.attempts += 1;
      item.lastError = String((error as any)?.message || error || 'ارسال انجام نشد');
      item.lastErrorCode = code;
      item.state = isRetryableChatError(code) && item.attempts < CHAT_MAX_AUTO_RETRIES ? 'queued' : 'failed';
      item.nextAttemptAt = item.state === 'queued'
        ? Date.now() + retryDelayMs(item.attempts - 1)
        : Number.MAX_SAFE_INTEGER;
      await putQueueItem(item);
      await emit();
      scheduleNextChatFlush();
    }
    if (isRetryableChatError(code)) return { data: null, queued: true, queueId };
    throw error;
  }

  if (!result.error) {
    await removeQueuedRpc(queueId);
    return { data: result.data, queued: false, queueId };
  }

  const code = classifyChatError(result.error);
  const item = (await listQueue()).find((value) => value.id === queueId);
  if (item) {
    item.attempts += 1;
    item.lastError = result.error.message;
    item.lastErrorCode = code;
    item.state = isRetryableChatError(code) && item.attempts < CHAT_MAX_AUTO_RETRIES ? 'queued' : 'failed';
    item.nextAttemptAt = item.state === 'queued'
      ? Date.now() + retryDelayMs(item.attempts - 1)
      : Number.MAX_SAFE_INTEGER;
    await putQueueItem(item);
    await emit();
  }

  if (isRetryableChatError(code)) return { data: null, queued: true, queueId };
  throw Object.assign(new Error(result.error.message), result.error);
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

      if (item.state === 'failed') continue;
      if ((item.nextAttemptAt ?? 0) > Date.now()) continue;

      if (isChatQueueItem(item)) {
        item.state = 'sending';
        await putQueueItem(item);
        await emit();
      }

      try {
        const { error } = await supabaseClient.rpc(item.functionName, item.args);
        if (!error) {
          await deleteQueueItem(item.id);
          await emit();
          continue;
        }

        if (isChatQueueItem(item)) {
          const code = classifyChatError(error);
          item.attempts += 1;
          item.lastError = error.message;
          item.lastErrorCode = code;
          if (isRetryableChatError(code) && item.attempts < CHAT_MAX_AUTO_RETRIES) {
            item.state = 'queued';
            item.nextAttemptAt = Date.now() + retryDelayMs(item.attempts - 1);
          } else {
            item.state = 'failed';
            item.nextAttemptAt = Number.MAX_SAFE_INTEGER;
          }
          await putQueueItem(item);
          await emit();
          continue;
        }

        item.attempts += 1;
        item.lastError = error.message;
        await putQueueItem(item);
        if (isNetworkError(error)) break;
      } catch (error) {
        if (isChatQueueItem(item)) {
          const code = classifyChatError(error);
          item.attempts += 1;
          item.lastError = String((error as any)?.message || error);
          item.lastErrorCode = code;
          if (isRetryableChatError(code) && item.attempts < CHAT_MAX_AUTO_RETRIES) {
            item.state = 'queued';
            item.nextAttemptAt = Date.now() + retryDelayMs(item.attempts - 1);
          } else {
            item.state = 'failed';
            item.nextAttemptAt = Number.MAX_SAFE_INTEGER;
          }
          await putQueueItem(item);
          await emit();
          continue;
        }

        item.attempts += 1;
        item.lastError = String((error as any)?.message || error);
        await putQueueItem(item);
        if (isNetworkError(error)) break;
      }
    }
  } finally {
    flushing = false;
    await emit();
    chatFlushTimer = null;
    scheduleNextChatFlush();
  }
};

export const retryQueuedRpc = async (id: string) => {
  const userId = await currentUserId();
  if (!userId) throw new Error('ابتدا وارد سیستم شوید.');
  const items = await listQueue();
  const item = items.find((value) => value.id === id && value.userId === userId);
  if (!item) throw new Error('پیام در صف پیدا نشد.');
  item.state = 'queued';
  item.attempts = 0;
  item.lastError = undefined;
  item.lastErrorCode = undefined;
  item.nextAttemptAt = Date.now();
  await putQueueItem(item);
  await emit();
  await flushOfflineQueue();
};

export const retryChatMessage = async (clientUuid: string) => {
  const items = await listQueue();
  const item = items.find((value) => isChatQueueItem(value) && chatClientUuid(value) === clientUuid);
  if (!item) return false;
  await retryQueuedRpc(item.id);
  return true;
};

export const startOfflineQueue = () => {
  if (stopOfflineQueue) return stopOfflineQueue;
  const flush = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine) void flushOfflineQueue();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') flush();
  };
  const onOnline = () => flush();
  const onPageShow = () => flush();
  window.addEventListener('online', onOnline);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibilityChange);
  flush();
  const timer = window.setInterval(flush, 30000);
  const stop = () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.clearInterval(timer);
    if (stopOfflineQueue === stop) stopOfflineQueue = null;
  };
  stopOfflineQueue = stop;
  return stop;
};

export const rpcWithOfflineQueue = async (
  functionName: string,
  args: Record<string, unknown>,
  options?: { queueWhenOffline?: boolean },
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
