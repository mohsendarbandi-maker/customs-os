/**
 * Forward Cloudflare's verified client IP to Supabase Auth's token endpoint.
 *
 * Supabase's token-refresh rate limit is IP-based. A Worker proxy otherwise
 * makes unrelated browsers share the Worker's single egress IP. Supabase only
 * honors Sb-Forwarded-For when the request uses a server-side secret API key.
 *
 * This function is intentionally limited to /auth/v1/token. The secret key is
 * never added to PostgREST, Storage, Realtime, or other Auth endpoints.
 */
export function applySupabaseAuthForwardedFor(
  headers: Headers,
  pathname: string,
  clientIp: string | null,
  secretApiKey?: string,
): boolean {
  const ip = clientIp?.trim();
  const secret = secretApiKey?.trim();

  if (pathname !== '/auth/v1/token' || !ip || !secret.startsWith('sb_secret_')) return false;

  // Cloudflare supplies this header on requests reaching the Worker. Reject
  // malformed values defensively rather than passing arbitrary header content.
  if (ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return false;

  headers.set('apikey', secret);
  headers.set('Sb-Forwarded-For', ip);
  return true;
}
