import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { attachSupabaseClient, rpcWithOfflineQueue } from './offlineQueue';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

const baseClient = createClient(supabaseUrl, supabaseAnonKey);
attachSupabaseClient(baseClient);

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
