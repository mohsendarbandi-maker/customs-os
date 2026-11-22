import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export function SessionLifecycle() {
  const { session } = useAuth();
  useEffect(() => {
    // Cloudflare staging uses an HttpOnly D1-backed session cookie. It must not
    // register synthetic Supabase sessions or query the unavailable old database.
    if (window.location.hostname.endsWith('.workers.dev')) return;
    void session;
  }, [session]);
  return null;
}
