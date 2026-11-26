import {
  handleCloudflareAuthApi,
  type CloudflareAuthDatabase,
} from './cloudflare-auth-api';

export interface CloudflareAuthRouteEnvironment {
  CUSTOMS_AUTH_DB?: CloudflareAuthDatabase;
  AUTH_PEPPER?: string;
}

export function isCloudflareAuthRoute(pathname: string) {
  return pathname === '/api/auth' || pathname.startsWith('/api/auth/');
}

export async function handleCloudflareAuthRoute(
  request: Request,
  url: URL,
  env: CloudflareAuthRouteEnvironment,
): Promise<Response | null> {
  if (!isCloudflareAuthRoute(url.pathname)) return null;
  if (!env.CUSTOMS_AUTH_DB || !env.AUTH_PEPPER) {
    return new Response(
      JSON.stringify({ ok: false, error: 'AUTH_NOT_CONFIGURED' }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, private',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  }
  return handleCloudflareAuthApi(
    request,
    env.CUSTOMS_AUTH_DB,
    url,
    { AUTH_PEPPER: env.AUTH_PEPPER },
  );
}
