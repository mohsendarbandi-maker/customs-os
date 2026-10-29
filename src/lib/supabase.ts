import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { attachSupabaseClient, rpcWithOfflineQueue, startOfflineQueue, readOfflineQueryCache, saveOfflineQueryCache } from './offlineQueue';
import { authSessionStorage } from './authStorage';

const env = (import.meta as any).env;
const configuredSupabaseUrl = env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY as string;
// Local development may talk to Supabase directly. Production apps (main,
// chat, reminders, and workers.dev) must use their own origin so the Worker
// can proxy Auth, PostgREST, Storage, Realtime, and Edge Functions together.
const isLocalDevelopment =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);
const supabaseUrl = isLocalDevelopment
  ? configuredSupabaseUrl
  : (typeof window !== 'undefined' ? window.location.origin : configuredSupabaseUrl);
export const SUPABASE_AUTH_STORAGE_KEY = 'customs-os-auth-v3';

type CachedRestResponse = {
  status: number;
  headers: Array<[string, string]>;
  body: string;
};

const nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis);
let authClient: SupabaseClient | null = null;
const restCacheScopes = new Map<string, { organizationId: string; checkedAt: number }>();
const MAX_CACHED_REST_BODY_CHARS = 400_000;
const REST_RESPONSE_HEADERS = [
  'content-type',
  'content-range',
  'content-profile',
  'accept-profile',
  'range-unit',
  'etag',
  'last-modified',
  'x-total-count',
] as const;

// Only cache authenticated, read-only PostgREST JSON. Auth, chat, profiles,
// files/storage, documents, financial records, RPC calls, and query strings that
// contain personal identifiers are intentionally excluded.
const canCacheRestRead = (request: Request) => {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/rest/v1/')) return false;
  const table = url.pathname.slice('/rest/v1/'.length).split('/')[0]?.toLowerCase() ?? '';
  if (
    !table ||
    table === 'rpc' ||
    /^(?:profiles|chat(?:_|$)|storage|finance|invoice|payment|bank|audit|notification|push|messenger|webhook|credential|secret|auth|user_settings|user_roles|api_keys|client|customer|contact|declaration|pre_declaration|shipment_cost|receipt)/i.test(table) ||
    /(?:^|_)(?:documents?|files?|attachments?|credentials?|secrets?|financial|invoices?|payments?|banks?|audits?|customers?|clients?|contacts?|declarations?|shipment_costs?|receipts?)(?:_|$)/i.test(table)
  ) return false;
  if (!request.headers.has('authorization')) return false;
  if (/(?:phone|email|password|secret|token|tax_id|passport|document_number|storage_path|signed_url)/i.test(url.search)) return false;
  return true;
};

const hashCacheKey = async (value: string) => {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }
};

const getRestCacheScope = async () => {
  if (!authClient) return null;
  try {
    const { data } = await authClient.auth.getSession();
    const session = data.session;
    const userId = session?.user.id;
    if (!userId || !session?.access_token) return null;
    const knownScope = restCacheScopes.get(userId);
    if (knownScope && Date.now() - knownScope.checkedAt < 30_000) {
      return { userId, organizationId: knownScope.organizationId, accessToken: session.access_token };
    }
    const cachedProfile = await readOfflineQueryCache<{ organization_id?: string | null; is_active?: boolean }>(
      'auth-profile',
      userId,
      userId,
    ).catch(() => null);
    const organizationId = cachedProfile?.payload?.organization_id;
    if (cachedProfile?.payload?.is_active !== true || !organizationId) {
      restCacheScopes.delete(userId);
      return null;
    }
    restCacheScopes.set(userId, { organizationId, checkedAt: Date.now() });
    return { userId, organizationId, accessToken: session.access_token };
  } catch {
    return null;
  }
};

const cacheRestResponse = async (
  namespace: string,
  userId: string,
  organizationId: string,
  response: Response,
) => {
  if (response.status !== 200) return;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return;
  try {
    const body = await response.text();
    if (!body || body.length > MAX_CACHED_REST_BODY_CHARS) return;
    const headers: Array<[string, string]> = [];
    for (const name of REST_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers.push([name, value]);
    }
    const payload: CachedRestResponse = { status: response.status, headers, body };
    await saveOfflineQueryCache('rest-get:' + namespace, userId, organizationId, payload);
  } catch {
    // Cache storage is an optimization; it must never break an online API call.
  }
};

const cachedRestFetch: typeof fetch = async (input, init) => {
  let request: Request;
  try {
    request = input instanceof Request ? new Request(input, init) : new Request(input, init);
  } catch {
    return nativeFetch(input, init);
  }
  if (!canCacheRestRead(request)) return nativeFetch(input, init);

  const scope = await getRestCacheScope();
  if (!scope || request.headers.get('authorization') !== 'Bearer ' + scope.accessToken) return nativeFetch(input, init);

  const vary = [
    request.url,
    request.headers.get('accept') || '',
    request.headers.get('prefer') || '',
    request.headers.get('range') || '',
    request.headers.get('accept-profile') || '',
    request.headers.get('content-profile') || '',
  ].join('\n');
  const namespace = await hashCacheKey(vary);
  try {
    const cached = await readOfflineQueryCache<CachedRestResponse>(
      'rest-get:' + namespace,
      scope.userId,
      scope.organizationId,
    );
    const payload = cached?.payload;
    if (payload && payload.status === 200 && typeof payload.body === 'string' && Array.isArray(payload.headers)) {
      // Revalidate in the background while returning the last user-scoped result immediately.
      void nativeFetch(input, init)
        .then(response => cacheRestResponse(namespace, scope.userId, scope.organizationId, response.clone()))
        .catch(() => undefined);
      const headers = new Headers(payload.headers);
      headers.set('X-Customs-OS-Read-Cache', 'HIT');
      return new Response(payload.body, { status: payload.status, headers });
    }
  } catch {
    // Fall through to the network if IndexedDB is unavailable.
  }

  const response = await nativeFetch(input, init);
  if (response.ok) {
    void cacheRestResponse(namespace, scope.userId, scope.organizationId, response.clone());
  }
  return response;
};

// Drop the legacy Supabase auth storage namespace once so stale refresh tokens
// from earlier builds cannot keep failing in a background tab.
try {
  const migrationKey = 'customs-os-auth-storage-migrated-v3';
  if (localStorage.getItem(migrationKey) !== '1') {
    localStorage.removeItem('sb-bjngfgiecvihofemptub-auth-token');
    sessionStorage.removeItem('sb-bjngfgiecvihofemptub-auth-token');
    localStorage.setItem(migrationKey, '1');
  }
} catch {}

const baseClient = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: cachedRestFetch },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    storage: authSessionStorage,
  },
});
authClient = baseClient;
attachSupabaseClient(baseClient);
if (typeof window !== 'undefined') startOfflineQueue();

// Keep the existing Supabase API unchanged while transparently queueing only
// replay-safe workflow RPCs when the browser is offline or loses the connection.
export const supabase = new Proxy(baseClient as SupabaseClient, {
  get(target, property, receiver) {
    if (property === 'rpc') {
      return (functionName: string, args?: Record<string, unknown>) =>
        rpcWithOfflineQueue(functionName, args || {});
    }
    return Reflect.get(target, property, receiver);
  },
});
