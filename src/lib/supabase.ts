import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { attachSupabaseClient, rpcWithOfflineQueue, startOfflineQueue } from './offlineQueue';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;
export const SUPABASE_AUTH_STORAGE_KEY = 'customs-os-auth-v3';

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
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
  },
});
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
