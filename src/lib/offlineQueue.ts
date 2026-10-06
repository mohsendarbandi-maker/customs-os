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
const DB_VERSION = 3;
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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('state', 'state', { unique: false });
        store.createIndex('nextAttemptAt', 'nextAttemptAt', { unique: false });
        return;
      }
      const store = transaction?.objectStore(STORE_NAME);
      if (!store) return;
      if (!store.indexNames.contains('userId')) store.createIndex('userId', 'userId', { unique: false });
      if (!store.indexNames.contains('state')) store.createIndex('state', 'state', { unique: false });
      if (!store.indexNames.contains('nextAttemptAt')) store.createIndex('nextAttemptAt', 'nextAttemptAt', { unique: false });
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
  if (/network|fetch|failed to fetch|offline|timeout|timed out|connection|اتصال/.test(message) || !navigator.onLine) {
    return 'NETWORK_ERROR';
  }
  return 'UNKNOWN';
};

const isRetryableChatError = (code: ChatErrorCode) =>
  code === 'NETWORK_ERROR' || code === 'SERVER_ERROR' || code === 'RATE_LIMIT';

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

const isNetworkError = (error: unknown) => classifyChatError(error) === 'NETWORK_ERROR';

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
