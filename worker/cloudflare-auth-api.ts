/**
 * Cloudflare-native, multi-user authentication API.
 *
 * This module deliberately has no static/shared administrator credential.
 * It is not wired into the production Worker until an audited D1 binding and
 * complete tenant-aware profile import are available.
 */
export interface CloudflareAuthStatement {
  bind(...values: unknown[]): CloudflareAuthStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface CloudflareAuthDatabase {
  prepare(sql: string): CloudflareAuthStatement;
  batch(statements: CloudflareAuthStatement[]): Promise<unknown[]>;
}

type Role = 'owner' | 'admin' | 'broker' | 'accountant' | 'warehouse' | 'client';
type ProfileRow = {
  id: string;
  organization_id: string | null;
  role: string | null;
  client_id: string | null;
  full_name: string | null;
  phone: string | null;
  is_active: number | boolean;
};
type CredentialRow = {
  user_id: string;
  email_normalized: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  failed_attempts: number;
  locked_until: string | null;
  password_reset_required: number | boolean;
};
type SessionRow = {
  session_id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  last_seen_at: string | null;
  email_normalized: string;
  organization_id: string | null;
  role: string | null;
  client_id: string | null;
  full_name: string | null;
  phone: string | null;
  is_active: number | boolean;
};

const COOKIE_NAME = 'customs_os_session';
const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_IP_LIMIT = 20;
const USER_LOCK_THRESHOLD = 5;
const USER_LOCK_MS = 15 * 60 * 1000;
const PASSWORD_ITERATIONS = 310_000;
const ALLOWED_ROLES = new Set<Role>(['owner', 'admin', 'broker', 'accountant', 'warehouse', 'client']);

const json = (body: unknown, status = 200, headersInit: HeadersInit = {}) => {
  const headers = new Headers(headersInit);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store, private');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'same-origin');
  return new Response(JSON.stringify(body), { status, headers });
};
const fail = (code: string, status: number) => json({ ok: false, error: code }, status);
const encoder = new TextEncoder();
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string) => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('Invalid hex');
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};
const sha256 = async (value: string) =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const secureToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};
const safeEqual = (left: Uint8Array, right: Uint8Array) => {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
};

export const normalizeAuthEmail = (value: string) =>
  value.normalize('NFKC').trim().toLowerCase();

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function createCloudflarePasswordCredential(password: string) {
  if (password.length < 12 || password.length > 256) throw new Error('PASSWORD_POLICY');
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  const hash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  return {
    password_hash: toHex(hash),
    password_salt: toHex(salt),
    password_iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyCloudflarePassword(
  password: string,
  storedHash: string,
  storedSalt: string,
  iterations: number,
) {
  if (
    password.length < 1 || password.length > 256 ||
    !/^[0-9a-f]{64}$/i.test(storedHash) ||
    !/^[0-9a-f]{64}$/i.test(storedSalt) ||
    !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000
  ) return false;
  try {
    const actual = await derivePasswordHash(password, fromHex(storedSalt), iterations);
    return safeEqual(actual, fromHex(storedHash));
  } catch {
    return false;
  }
}

const readCookie = (request: Request) => {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === COOKIE_NAME) return part.slice(separator + 1).trim();
  }
  return '';
};

const cookieDomain = (hostname: string) => {
  const host = hostname.toLowerCase();
  return host === 'darbandicommercial.ir' || host.endsWith('.darbandicommercial.ir')
    ? '; Domain=.darbandicommercial.ir'
    : '';
};
const sessionCookie = (url: URL, token: string, maxAge = SESSION_SECONDS) =>
  `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}${cookieDomain(url.hostname)}`;
const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) &&
    request.headers.get('sec-fetch-site') !== 'cross-site';
};
const deviceLabel = (userAgent: string) => {
  const device = /iPhone/i.test(userAgent) ? 'iPhone'
    : /iPad/i.test(userAgent) ? 'iPad'
    : /Android/i.test(userAgent) ? 'Android'
    : /Windows/i.test(userAgent) ? 'Windows'
    : /Macintosh|Mac OS X/i.test(userAgent) ? 'macOS'
    : /Linux/i.test(userAgent) ? 'Linux' : 'مرورگر وب';
  const browser = /Edg\//i.test(userAgent) ? 'Edge'
    : /Firefox\//i.test(userAgent) ? 'Firefox'
    : /OPR\//i.test(userAgent) ? 'Opera'
    : /Chrome\//i.test(userAgent) ? 'Chrome'
    : /Safari\//i.test(userAgent) ? 'Safari' : 'مرورگر';
  return `${device} · ${browser}`;
};

const parseProfile = (row: ProfileRow | null, expectedUserId: string) => {
  if (
    !row || row.id !== expectedUserId ||
    (row.is_active !== true && row.is_active !== 1) ||
    typeof row.organization_id !== 'string' || !row.organization_id.trim() ||
    typeof row.role !== 'string' || !ALLOWED_ROLES.has(row.role as Role) ||
    (row.role === 'client' && (typeof row.client_id !== 'string' || !row.client_id.trim()))
  ) return null;
  return {
    id: row.id,
    organization_id: row.organization_id,
    role: row.role as Role,
    client_id: row.client_id || null,
    full_name: row.full_name || '',
    phone: row.phone || null,
    is_active: true,
  };
};

async function recordIpFailure(db: CloudflareAuthDatabase, ipHash: string, now: number) {
  const started = new Date(now).toISOString();
  const prior = await db.prepare(
    'SELECT window_started_at, attempts FROM customs_os_auth_login_attempts WHERE ip_hash = ? LIMIT 1',
  ).bind(ipHash).first<{ window_started_at: string; attempts: number }>();
  if (prior && now - Date.parse(prior.window_started_at) < LOGIN_WINDOW_MS) {
    await db.prepare(
      'UPDATE customs_os_auth_login_attempts SET attempts = MIN(attempts + 1, 100) WHERE ip_hash = ?',
    ).bind(ipHash).run();
    return Number(prior.attempts) + 1;
  }
  await db.prepare(
    'INSERT INTO customs_os_auth_login_attempts (ip_hash, window_started_at, attempts) VALUES (?, ?, 1) ' +
    'ON CONFLICT(ip_hash) DO UPDATE SET window_started_at = excluded.window_started_at, attempts = 1',
  ).bind(ipHash, started).run();
  return 1;
}

async function readActiveSession(db: CloudflareAuthDatabase, token: string, nowIso: string) {
  if (!token || token.length !== 64 || !/^[0-9a-f]{64}$/i.test(token)) return null;
  const tokenHash = await sha256(token);
  const row = await db.prepare(
    'SELECT s.session_id, s.user_id, s.token_hash, s.expires_at, s.last_seen_at, ' +
    'c.email_normalized, p.organization_id, p.role, p.client_id, p.full_name, p.phone, p.is_active ' +
    'FROM customs_os_auth_sessions s ' +
    'JOIN customs_os_auth_credentials c ON c.user_id = s.user_id ' +
    'JOIN profiles p ON p.id = s.user_id ' +
    'WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? LIMIT 1',
  ).bind(tokenHash, nowIso).first<SessionRow>();
  if (!row) return null;
  const profile = parseProfile(row as unknown as ProfileRow, row.user_id);
  if (!profile) {
    await db.prepare(
      'UPDATE customs_os_auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    ).bind(nowIso, tokenHash).run();
    return null;
  }
  const lastSeen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 5 * 60 * 1000) {
    await db.prepare(
      'UPDATE customs_os_auth_sessions SET last_seen_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    ).bind(nowIso, tokenHash).run();
  }
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tokenHash,
    email: row.email_normalized,
    profile,
  };
}

const requestId = (request: Request) => request.headers.get('cf-ray') || crypto.randomUUID();
async function writeEvent(
  db: CloudflareAuthDatabase,
  actorUserId: string,
  targetUserId: string,
  eventType: 'login' | 'logout' | 'session_revoked' | 'other_sessions_revoked' | 'password_changed',
  sessionId: string | null,
  request: Request,
  details: Record<string, unknown> = {},
) {
  await db.prepare(
    'INSERT INTO customs_os_auth_events ' +
    '(id, actor_user_id, target_user_id, event_type, session_id, request_id, details_json, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    crypto.randomUUID(), actorUserId, targetUserId, eventType, sessionId,
    requestId(request), JSON.stringify(details), new Date().toISOString(),
  ).run();
}

const responseForSession = (
  session: { userId: string; email: string; profile: ReturnType<typeof parseProfile>; sessionId: string; passwordResetRequired?: boolean },
) => ({
  authenticated: true,
  user: {
    id: session.userId,
    email: session.email,
    full_name: session.profile?.full_name || '',
  },
  profile: session.profile,
  session_id: session.sessionId,
  password_reset_required: Boolean(session.passwordResetRequired),
});

async function login(request: Request, db: CloudflareAuthDatabase, url: URL) {
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 8_192) return fail('REQUEST_TOO_LARGE', 413);

  let body: { email?: unknown; password?: unknown };
  try { body = await request.json() as { email?: unknown; password?: unknown }; }
  catch { return fail('INVALID_REQUEST', 400); }
  const email = typeof body.email === 'string' ? normalizeAuthEmail(body.email) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (email.length < 3 || email.length > 320 || !email.includes('@') || password.length < 1 || password.length > 256) {
    return fail('INVALID_CREDENTIALS', 401);
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ipHash = await sha256(ip);
  const priorIp = await db.prepare(
    'SELECT window_started_at, attempts FROM customs_os_auth_login_attempts WHERE ip_hash = ? LIMIT 1',
  ).bind(ipHash).first<{ window_started_at: string; attempts: number }>();
  if (priorIp && now - Date.parse(priorIp.window_started_at) < LOGIN_WINDOW_MS &&
      Number(priorIp.attempts) >= LOGIN_IP_LIMIT) return fail('RATE_LIMITED', 429);

  const credential = await db.prepare(
    'SELECT user_id, email_normalized, password_hash, password_salt, password_iterations, ' +
    'failed_attempts, locked_until, password_reset_required ' +
    'FROM customs_os_auth_credentials WHERE email_normalized = ? LIMIT 1',
  ).bind(email).first<CredentialRow>();

  if (credential?.locked_until && Date.parse(credential.locked_until) > now) {
    await recordIpFailure(db, ipHash, now);
    return fail('RATE_LIMITED', 429);
  }

  // Unknown addresses still execute a PBKDF2 operation to reduce account-enumeration timing.
  const validPassword = credential
    ? await verifyCloudflarePassword(password, credential.password_hash, credential.password_salt, credential.password_iterations)
    : await verifyCloudflarePassword(password, '0'.repeat(64), 'a'.repeat(64), 100_000).then(() => false);

  if (!credential || !validPassword) {
    if (credential) {
      const failures = Number(credential.failed_attempts || 0) + 1;
      const lockedUntil = failures >= USER_LOCK_THRESHOLD
        ? new Date(now + USER_LOCK_MS).toISOString()
        : null;
      await db.prepare(
        'UPDATE customs_os_auth_credentials SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE user_id = ?',
      ).bind(failures, lockedUntil, nowIso, credential.user_id).run();
    }
    await recordIpFailure(db, ipHash, now);
    return fail('INVALID_CREDENTIALS', 401);
  }

  const profileRow = await db.prepare(
    'SELECT id, organization_id, role, client_id, full_name, phone, is_active FROM profiles WHERE id = ? LIMIT 1',
  ).bind(credential.user_id).first<ProfileRow>();
  const profile = parseProfile(profileRow, credential.user_id);
  if (!profile) return fail('ACCOUNT_NOT_READY_OR_DISABLED', 403);

  const token = secureToken();
  const tokenHash = await sha256(token);
  const sessionId = crypto.randomUUID();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + SESSION_SECONDS * 1000).toISOString();
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 500);
  const label = deviceLabel(userAgent);
  await db.batch([
    db.prepare(
      'UPDATE customs_os_auth_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?',
    ).bind(createdAt, credential.user_id),
    db.prepare(
      'INSERT INTO customs_os_auth_sessions ' +
      '(session_id, user_id, token_hash, created_at, expires_at, last_seen_at, device_label, app_origin) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(sessionId, credential.user_id, tokenHash, createdAt, expiresAt, createdAt, label, url.origin),
    db.prepare(
      'DELETE FROM customs_os_auth_login_attempts WHERE ip_hash = ?',
    ).bind(ipHash),
    db.prepare(
      'INSERT INTO customs_os_auth_events ' +
      '(id, actor_user_id, target_user_id, event_type, session_id, request_id, details_json, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(), credential.user_id, credential.user_id, 'login',
      sessionId, requestId(request), JSON.stringify({ device_label: label }), createdAt,
    ),
  ]);

  return json(responseForSession({
    userId: credential.user_id,
    email: credential.email_normalized,
    profile,
    sessionId,
    passwordResetRequired: Boolean(credential.password_reset_required),
  }), 200, { 'set-cookie': sessionCookie(url, token) });
}

async function getSession(request: Request, db: CloudflareAuthDatabase, url: URL) {
  if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405);
  const token = readCookie(request);
  if (!token) return json({ authenticated: false });
  const active = await readActiveSession(db, token, new Date().toISOString());
  if (!active) return json({ authenticated: false }, 200, { 'set-cookie': sessionCookie(url, '', 0) });
  const credential = await db.prepare(
    'SELECT password_reset_required FROM customs_os_auth_credentials WHERE user_id = ? LIMIT 1',
  ).bind(active.userId).first<{ password_reset_required: number | boolean }>();
  return json(responseForSession({
    ...active,
    passwordResetRequired: Boolean(credential?.password_reset_required),
  }));
}

async function logout(request: Request, db: CloudflareAuthDatabase, url: URL) {
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  const token = readCookie(request);
  if (token) {
    const active = await readActiveSession(db, token, new Date().toISOString());
    if (active) {
      const now = new Date().toISOString();
      await db.prepare(
        'UPDATE customs_os_auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
      ).bind(now, active.tokenHash).run();
      await writeEvent(db, active.userId, active.userId, 'logout', active.sessionId, request, { scope: 'current_device' });
    }
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(url, '', 0) });
}

async function changePassword(request: Request, db: CloudflareAuthDatabase, url: URL) {
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  const active = await readActiveSession(db, readCookie(request), new Date().toISOString());
  if (!active) return fail('UNAUTHORIZED', 401);
  let body: { current_password?: unknown; new_password?: unknown };
  try { body = await request.json() as { current_password?: unknown; new_password?: unknown }; }
  catch { return fail('INVALID_REQUEST', 400); }
  const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
  const newPassword = typeof body.new_password === 'string' ? body.new_password : '';
  if (newPassword.length < 12 || newPassword.length > 256 || currentPassword.length < 1 || currentPassword.length > 256) {
    return fail('PASSWORD_POLICY', 400);
  }
  const credential = await db.prepare(
    'SELECT password_hash, password_salt, password_iterations FROM customs_os_auth_credentials WHERE user_id = ? LIMIT 1',
  ).bind(active.userId).first<{ password_hash: string; password_salt: string; password_iterations: number }>();
  if (!credential || !await verifyCloudflarePassword(currentPassword, credential.password_hash, credential.password_salt, credential.password_iterations)) {
    return fail('CURRENT_PASSWORD_INVALID', 401);
  }
  const next = await createCloudflarePasswordCredential(newPassword);
  const now = new Date().toISOString();
  const token = secureToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await db.batch([
    db.prepare(
      'UPDATE customs_os_auth_credentials SET password_hash = ?, password_salt = ?, password_iterations = ?, ' +
      'password_version = password_version + 1, failed_attempts = 0, locked_until = NULL, ' +
      'password_reset_required = 0, password_changed_at = ?, updated_at = ? WHERE user_id = ?',
    ).bind(next.password_hash, next.password_salt, next.password_iterations, now, now, active.userId),
    db.prepare(
      'UPDATE customs_os_auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND token_hash <> ?',
    ).bind(now, active.userId, active.tokenHash),
    db.prepare(
      'UPDATE customs_os_auth_sessions SET token_hash = ?, created_at = ?, expires_at = ?, last_seen_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    ).bind(tokenHash, now, expiresAt, now, active.tokenHash),
    db.prepare(
      'INSERT INTO customs_os_auth_events ' +
      '(id, actor_user_id, target_user_id, event_type, session_id, request_id, details_json, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(), active.userId, active.userId, 'password_changed',
      active.sessionId, requestId(request), JSON.stringify({ other_sessions_revoked: true }), now,
    ),
  ]);
  return json({ ok: true, password_reset_required: false }, 200, { 'set-cookie': sessionCookie(url, token) });
}

async function devices(request: Request, db: CloudflareAuthDatabase, url: URL) {
  const active = await readActiveSession(db, readCookie(request), new Date().toISOString());
  if (!active) return fail('UNAUTHORIZED', 401);
  if (request.method === 'GET' && url.pathname === '/api/auth/devices') {
    const rows = await db.prepare(
      'SELECT session_id, device_label, app_origin, created_at, last_seen_at, ' +
      'CASE WHEN token_hash = ? THEN 1 ELSE 0 END AS is_current ' +
      'FROM customs_os_auth_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ' +
      'ORDER BY COALESCE(last_seen_at, created_at) DESC, created_at DESC LIMIT 50',
    ).bind(active.tokenHash, active.userId, new Date().toISOString()).all<{
      session_id: string; device_label: string | null; app_origin: string | null;
      created_at: string; last_seen_at: string | null; is_current: number | boolean;
    }>();
    return json({ ok: true, sessions: rows.results.map(row => ({
      session_id: row.session_id,
      device_label: row.device_label || 'دستگاه نامشخص',
      app_origin: row.app_origin,
      created_at: row.created_at,
      last_active_at: row.last_seen_at || row.created_at,
      is_current: Boolean(row.is_current),
    })), limit: 50 });
  }
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  if (request.method === 'POST' && url.pathname === '/api/auth/devices/revoke-others') {
    const now = new Date().toISOString();
    const results = await db.batch([
      db.prepare(
        'UPDATE customs_os_auth_sessions SET revoked_at = ? WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL AND expires_at > ?',
      ).bind(now, active.userId, active.tokenHash, now),
    ]);
    const changed = typeof results[0] === 'object' && results[0] !== null
      ? Number(((results[0] as { meta?: { changes?: number } }).meta?.changes) || 0) : 0;
    if (changed > 0) await writeEvent(db, active.userId, active.userId, 'other_sessions_revoked', null, request, { revoked_count: changed });
    return json({ ok: true, revoked_count: changed });
  }
  const match = url.pathname.match(/^\/api\/auth\/devices\/([0-9a-f-]{36})$/i);
  if (request.method === 'DELETE' && match) {
    const targetId = match[1];
    if (targetId === active.sessionId) return fail('CANNOT_REVOKE_CURRENT_SESSION', 409);
    const now = new Date().toISOString();
    const target = await db.prepare(
      'SELECT session_id FROM customs_os_auth_sessions WHERE user_id = ? AND session_id = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1',
    ).bind(active.userId, targetId, now).first<{ session_id: string }>();
    if (!target) return fail('DEVICE_SESSION_NOT_FOUND', 404);
    const changed = await db.prepare(
      'UPDATE customs_os_auth_sessions SET revoked_at = ? WHERE user_id = ? AND session_id = ? AND revoked_at IS NULL',
    ).bind(now, active.userId, targetId).run();
    const count = Number(changed.meta?.changes || 0);
    if (count > 0) await writeEvent(db, active.userId, active.userId, 'session_revoked', targetId, request, { scope: 'single_device' });
    return count > 0 ? json({ ok: true, revoked_count: count }) : fail('DEVICE_SESSION_NOT_FOUND', 404);
  }
  return fail('METHOD_NOT_ALLOWED', 405);
}

export async function handleCloudflareAuthApi(
  request: Request,
  db: CloudflareAuthDatabase,
  url: URL,
): Promise<Response> {
  try {
    if (url.pathname === '/api/auth/login') return await login(request, db, url);
    if (url.pathname === '/api/auth/session') return await getSession(request, db, url);
    if (url.pathname === '/api/auth/logout') return await logout(request, db, url);
    if (url.pathname === '/api/auth/password/change') return await changePassword(request, db, url);
    if (url.pathname === '/api/auth/devices' || url.pathname.startsWith('/api/auth/devices/')) {
      return await devices(request, db, url);
    }
    return fail('NOT_FOUND', 404);
  } catch {
    return fail('AUTH_STORAGE_UNAVAILABLE', 503);
  }
}
