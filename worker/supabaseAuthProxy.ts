/**
 * Forward Cloudflare's verified client IP to Supabase Auth's token endpoint.
 *
 * Supabase's token-refresh rate limit is IP-based. A Worker proxy otherwise
 * makes unrelated browsers share the Worker's single egress IP. Supabase only
 * honors Sb-Forwarded-For when the request uses a server-side secret API key.
 *
 * Supabase also blocks secret API keys when the upstream User-Agent looks like
 * a browser. Because this request is executed by this Worker, replace the
 * incoming browser User-Agent with a stable Worker identity before forwarding.
 *
 * This function is intentionally limited to /auth/v1/token. The secret key is
 * never added to PostgREST, Storage, Realtime, or other Auth endpoints.
 */
const SUPABASE_AUTH_WORKER_USER_AGENT = 'CustomsOS-Cloudflare-Worker/1.0';

export function applySupabaseAuthForwardedFor(
  headers: Headers,
  pathname: string,
  clientIp: string | null,
  secretApiKey?: string,
): boolean {
  const ip = clientIp?.trim();
  const secret = secretApiKey?.trim();

  if (pathname !== '/auth/v1/token' || !ip || !secret || !secret.startsWith('sb_secret_')) return false;

  // Cloudflare supplies this header on requests reaching the Worker. Reject
  // malformed values defensively rather than passing arbitrary header content.
  if (ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return false;

  headers.set('apikey', secret);
  headers.set('Sb-Forwarded-For', ip);
  // The secret is only used on this server-to-server hop. Do not forward the
  // visitor's Mozilla/Safari User-Agent, or Supabase classifies this as a
  // browser request and rejects the secret key with UNAUTHORIZED_INVALID_API_KEY_TYPE.
  headers.set('User-Agent', SUPABASE_AUTH_WORKER_USER_AGENT);
  return true;
}
