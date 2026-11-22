interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(sql: string): D1Statement;
}
interface StaticAssets {
  fetch(request: Request): Promise<Response>;
}
interface Env {
  MIGRATION_DB: D1Database;
  ASSETS?: StaticAssets;
  MIGRATION_ENVIRONMENT?: string;
  PRODUCTION_DATA_IMPORTED?: string;
  CUSTOMS_ADMIN_PASSWORD?: string;
}

const COOKIE = 'customs_os_stage_session';
const ADMIN_EMAIL = 'admin@darbandicommercial.ir';
const SESSION_HOURS = 12;
const profile = {
  id: 'owner-cloudflare-staging',
  organization_id: 'darbandi-commercial-staging',
  role: 'owner',
  full_name: 'مدیر سامانه',
  is_active: true,
};

const json = (body: unknown, status = 200, extra: HeadersInit = {}) => {
  const headers = new Headers(extra);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store, private');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'same-origin');
  return new Response(JSON.stringify(body), { status, headers });
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
};

const createToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

const constantTimeEqual = (left: string, right: string) => {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
};

const readCookie = (request: Request) => {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return value.join('=');
  }
  return '';
};

const setCookie = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

const isSameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) &&
    request.headers.get('sec-fetch-site') !== 'cross-site';
};

const getSession = async (request: Request, env: Env) => {
  const token = readCookie(request);
  if (!token) return false;
  const tokenHash = await sha256(token);
  const row = await env.MIGRATION_DB.prepare(
    'SELECT user_id, expires_at FROM customs_admin_sessions WHERE token_hash = ? LIMIT 1',
  ).bind(tokenHash).first<{ user_id: string; expires_at: string }>();
  if (!row) return false;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await env.MIGRATION_DB.prepare(
      'DELETE FROM customs_admin_sessions WHERE token_hash = ?',
    ).bind(tokenHash).run();
    return false;
  }
  return true;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'customs-os-staging',
        environment: env.MIGRATION_ENVIRONMENT ?? 'staging',
        database: 'd1',
        authentication: 'cloudflare-d1-session',
        productionTraffic: false,
        productionDataImported: env.PRODUCTION_DATA_IMPORTED === 'true',
      });
    }

    if (url.pathname === '/health/db' || url.pathname.startsWith('/migration/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      }
      if (url.pathname === '/health/db') {
        try {
          const manifest = await env.MIGRATION_DB.prepare(
            "SELECT id, stage, schema_version, updated_at FROM _migration_manifest WHERE id = 'customs-os' LIMIT 1",
          ).first();
          return manifest
            ? json({ ok: true, database: 'customs-os-migration-staging', manifest, operationalDataImported: false })
            : json({ ok: false, error: 'MIGRATION_MANIFEST_MISSING' }, 503);
        } catch {
          return json({ ok: false, error: 'STAGING_DATABASE_UNAVAILABLE' }, 503);
        }
      }
      if (url.pathname === '/migration/status') {
        try {
          const [manifest, tableStates, archives] = await Promise.all([
            env.MIGRATION_DB.prepare(
              "SELECT id, stage, schema_version, updated_at FROM _migration_manifest WHERE id = 'customs-os' LIMIT 1",
            ).first(),
            env.MIGRATION_DB.prepare(
              'SELECT status, COUNT(*) AS table_count FROM _migration_table_state GROUP BY status ORDER BY status',
            ).all(),
            env.MIGRATION_DB.prepare(
              'SELECT COUNT(*) AS function_count FROM supabase_edge_function_archive',
            ).first(),
          ]);
          const gates = {
            sourcePostgres: 'blocked_57P03',
            authoritativeSchemaExport: 'not_verified',
            operationalRows: 'not_imported',
            authUsersAndSessions: 'not_imported',
            storageObjects: 'not_imported',
            edgeFunctions: 'source_archived_not_ported',
            productionCutover: 'blocked',
          };
          return json({ ok: true, manifest, tableStates: tableStates.results, archivedFunctions: archives?.function_count ?? 0, gates });
        } catch {
          return json({ ok: false, error: 'MIGRATION_STATUS_UNAVAILABLE' }, 503);
        }
      }
      if (url.pathname === '/migration/functions') {
        try {
          const result = await env.MIGRATION_DB.prepare(
            'SELECT slug, source_version, source_status, file_count, total_chars, deployed_sha256 FROM supabase_edge_function_archive ORDER BY slug',
          ).all();
          return json({
            ok: true,
            count: result.results.length,
            note: 'Source archive only; functions are not deployed as Cloudflare replacements.',
            functions: result.results,
          });
        } catch {
          return json({ ok: false, error: 'FUNCTION_ARCHIVE_UNAVAILABLE' }, 503);
        }
      }
      return json({ ok: false, error: 'NOT_FOUND' }, 404);
    }

    if (url.pathname === '/api/auth/login') {
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
      if (!isSameOrigin(request, url)) return json({ error: 'ORIGIN_FORBIDDEN' }, 403);
      if (!env.CUSTOMS_ADMIN_PASSWORD) return json({ error: 'AUTH_NOT_CONFIGURED' }, 503);

      const ipHash = await sha256(request.headers.get('cf-connecting-ip') || 'unknown');
      const now = Date.now();
      const previous = await env.MIGRATION_DB.prepare(
        'SELECT window_started_at, attempts FROM customs_admin_login_attempts WHERE ip_hash = ?',
      ).bind(ipHash).first<{ window_started_at: string; attempts: number }>();

      if (previous && now - Date.parse(previous.window_started_at) < 10 * 60 * 1000 && previous.attempts >= 8) {
        return json({ error: 'RATE_LIMITED' }, 429);
      }

      let body: { email?: string; password?: string };
      try {
        body = await request.json() as { email?: string; password?: string };
      } catch {
        return json({ error: 'INVALID_REQUEST' }, 400);
      }

      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';
      if (password.length > 256 || email !== ADMIN_EMAIL ||
          !constantTimeEqual(password, env.CUSTOMS_ADMIN_PASSWORD)) {
        if (!previous || now - Date.parse(previous.window_started_at) >= 10 * 60 * 1000) {
          await env.MIGRATION_DB.prepare(
            'INSERT INTO customs_admin_login_attempts (ip_hash, window_started_at, attempts) VALUES (?, ?, 1) ' +
            'ON CONFLICT(ip_hash) DO UPDATE SET window_started_at = excluded.window_started_at, attempts = 1',
          ).bind(ipHash, new Date(now).toISOString()).run();
        } else {
          await env.MIGRATION_DB.prepare(
            'UPDATE customs_admin_login_attempts SET attempts = attempts + 1 WHERE ip_hash = ?',
          ).bind(ipHash).run();
        }
        return json({ error: 'INVALID_CREDENTIALS' }, 401);
      }

      await env.MIGRATION_DB.prepare(
        'DELETE FROM customs_admin_login_attempts WHERE ip_hash = ?',
      ).bind(ipHash).run();

      const token = createToken();
      const tokenHash = await sha256(token);
      const expiresAt = new Date(now + SESSION_HOURS * 60 * 60 * 1000).toISOString();
      await env.MIGRATION_DB.prepare(
        'INSERT INTO customs_admin_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      ).bind(tokenHash, profile.id, expiresAt).run();

      return json({
        authenticated: true,
        user: { id: profile.id, email: ADMIN_EMAIL, full_name: profile.full_name },
        profile,
      }, 200, { 'set-cookie': setCookie(token, SESSION_HOURS * 60 * 60) });
    }

    if (url.pathname === '/api/auth/session') {
      if (request.method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
      if (!await getSession(request, env)) return json({ authenticated: false });
      return json({
        authenticated: true,
        user: { id: profile.id, email: ADMIN_EMAIL, full_name: profile.full_name },
        profile,
      });
    }

    if (url.pathname === '/api/auth/logout') {
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
      if (!isSameOrigin(request, url)) return json({ error: 'ORIGIN_FORBIDDEN' }, 403);
      const token = readCookie(request);
      if (token) {
        await env.MIGRATION_DB.prepare(
          'DELETE FROM customs_admin_sessions WHERE token_hash = ?',
        ).bind(await sha256(token)).run();
      }
      return json({ ok: true }, 200, { 'set-cookie': setCookie('', 0) });
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'API_NOT_FOUND' }, 404);

    // Supabase-compatible API paths are intentionally not proxied or mocked.
    // Their source schema/users are unavailable; returning JSON 503 avoids
    // accidentally serving index.html as a false successful database response.
    if (/^\/(auth|rest|storage|functions|realtime)\/v1(?:\/|$)/.test(url.pathname)) {
      return json({ error: 'BACKEND_MIGRATION_PENDING', message: 'Operational data services are being migrated.' }, 503);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    if (!env.ASSETS) return new Response('Static app assets are not bound', { status: 503 });
    return env.ASSETS.fetch(request);
  },
};
