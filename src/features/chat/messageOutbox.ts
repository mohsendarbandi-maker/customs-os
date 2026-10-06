export type ChatSendErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'PERMISSION_ERROR'
  | 'VALIDATION_ERROR'
  | 'SERVER_ERROR'
  | 'RATE_LIMIT'
  | 'UNKNOWN';

export type QueuedChatMessage = {
  clientUuid: string;
  organizationId: string;
  conversationId: string;
  senderId: string;
  body: string;
  replyToMessageId: string | null;
  createdAtLocal: string;
  state: 'queued' | 'sending' | 'failed';
  attempts: number;
  nextAttemptAt: number;
  lastErrorCode: ChatSendErrorCode | null;
  lastErrorMessage: string | null;
};

const DB_NAME = 'customs-os-chat';
const DB_VERSION = 1;
const STORE_NAME = 'message-outbox';

const hasIndexedDb = () =>
  typeof globalThis !== 'undefined' &&
  'indexedDB' in globalThis &&
  Boolean(globalThis.indexedDB);

const openDb = async (): Promise<IDBDatabase | null> => {
  if (!hasIndexedDb()) return null;

  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error ?? new Error('IndexedDB باز نشد.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'clientUuid' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> => {
  const db = await openDb();
  if (!db) return undefined;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let request: IDBRequest<T> | undefined;

    try {
      request = work(store) as IDBRequest<T> | undefined;
    } catch (error) {
      db.close();
      reject(error);
      return;
    }

    tx.oncomplete = () => {
      db.close();
      resolve(request?.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('ذخیره‌سازی محلی چت انجام نشد.'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('ذخیره‌سازی محلی چت لغو شد.'));
    };
  });
};

export const CHAT_MAX_AUTO_RETRIES = 8;

export const retryDelayMs = (attempts: number): number => {
  const safeAttempts = Math.max(0, Math.min(attempts, CHAT_MAX_AUTO_RETRIES));
  return Math.min(30000, 1000 * (2 ** safeAttempts));
};

export const classifyChatSendError = (error: unknown): ChatSendErrorCode => {
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof candidate?.code === 'string' ? candidate.code.toUpperCase() : '';
  const status = typeof candidate?.status === 'number' ? candidate.status : undefined;
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : '';

  if (
    code === 'AUTH_ERROR' ||
    code === 'PGRST301' ||
    status === 401 ||
    /jwt|session|not authenticated|احراز هویت|نشست/.test(message)
  ) return 'AUTH_ERROR';

  if (
    code === '42501' ||
    status === 403 ||
    /permission|forbidden|not allowed|دسترسی|مجاز نیست/.test(message)
  ) return 'PERMISSION_ERROR';

  if (
    code === '22P02' ||
    code === '23514' ||
    status === 400 ||
    /invalid|validation|نامعتبر|طولانی‌تر|الزامی/.test(message)
  ) return 'VALIDATION_ERROR';

  if (status === 429 || /rate limit|too many requests|محدودیت درخواست/.test(message)) {
    return 'RATE_LIMIT';
  }

  if (
    status !== undefined &&
    status >= 500 ||
    /network|fetch|failed to fetch|timeout|timed out|networkerror|اتصال|درخواست/.test(message)
  ) return status !== undefined && status >= 500 ? 'SERVER_ERROR' : 'NETWORK_ERROR';

  return 'UNKNOWN';
};

export const isAutoRetryableChatError = (code: ChatSendErrorCode) =>
  code === 'NETWORK_ERROR' || code === 'SERVER_ERROR' || code === 'RATE_LIMIT';

export async function putQueuedChatMessage(message: QueuedChatMessage): Promise<void> {
  await withStore('readwrite', (store) => store.put(message));
}

export async function getQueuedChatMessage(clientUuid: string): Promise<QueuedChatMessage | null> {
  const value = await withStore<QueuedChatMessage | undefined>('readonly', (store) => store.get(clientUuid));
  return value ?? null;
}

export async function listQueuedChatMessages(
  conversationId?: string,
  states: Array<QueuedChatMessage['state']> = ['queued', 'sending', 'failed'],
): Promise<QueuedChatMessage[]> {
  const values = await withStore<QueuedChatMessage[]>('readonly', (store) => store.getAll());
  const filtered = (values ?? []).filter((item) =>
    (!conversationId || item.conversationId === conversationId) &&
    states.includes(item.state),
  );
  return filtered.sort((a, b) => {
    const time = new Date(a.createdAtLocal).getTime() - new Date(b.createdAtLocal).getTime();
    return time || a.clientUuid.localeCompare(b.clientUuid);
  });
}

export async function listDueQueuedChatMessages(
  now = Date.now(),
  conversationId?: string,
): Promise<QueuedChatMessage[]> {
  const items = await listQueuedChatMessages(conversationId, ['queued']);
  return items.filter((item) => item.nextAttemptAt <= now);
}

export async function patchQueuedChatMessage(
  clientUuid: string,
  patch: Partial<QueuedChatMessage>,
): Promise<QueuedChatMessage | null> {
  const current = await getQueuedChatMessage(clientUuid);
  if (!current) return null;
  const next = { ...current, ...patch };
  await putQueuedChatMessage(next);
  return next;
}

export async function removeQueuedChatMessage(clientUuid: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(clientUuid));
}

export async function clearChatOutboxForUser(
  senderId: string,
  organizationId: string,
): Promise<void> {
  const items = await listQueuedChatMessages();
  const owned = items.filter((item) => item.senderId === senderId && item.organizationId === organizationId);
  for (const item of owned) await removeQueuedChatMessage(item.clientUuid);
}

export async function scheduleQueuedChatRetry(
  clientUuid: string,
  code: ChatSendErrorCode,
  message: string,
): Promise<QueuedChatMessage | null> {
  const current = await getQueuedChatMessage(clientUuid);
  if (!current) return null;

  const attempts = current.attempts + 1;
  const terminal = !isAutoRetryableChatError(code) || attempts >= CHAT_MAX_AUTO_RETRIES;
  return patchQueuedChatMessage(clientUuid, {
    state: terminal ? 'failed' : 'queued',
    attempts,
    nextAttemptAt: terminal ? Number.MAX_SAFE_INTEGER : Date.now() + retryDelayMs(attempts - 1),
    lastErrorCode: code,
    lastErrorMessage: message,
  });
}

export async function retryQueuedChatMessage(clientUuid: string): Promise<QueuedChatMessage | null> {
  return patchQueuedChatMessage(clientUuid, {
    state: 'queued',
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastErrorCode: null,
    lastErrorMessage: null,
  });
}
