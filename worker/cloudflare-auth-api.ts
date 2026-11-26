/**
 * Cloudflare D1 multi-user authentication API.
 *
 * The password KDF is performed in the browser because Worker's WebCrypto PBKDF2
 * has a platform iteration ceiling and Free Workers have a strict CPU budget.
 * D1 stores only an AES-GCM-encrypted verifier. The encryption key is a Worker
 * secret (AUTH_PEPPER), so a D1-only disclosure does not expose a pass-the-hash
 * value. Each login/password-change proof is HMAC-bound to a one-time challenge.
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
export interface CloudflareAuthEnvironment {
  AUTH_PEPPER?: string;
}

type Role = 'owner' | 'admin' | 'broker' | 'accountant' | 'warehouse' | 'client';
type CredentialRow = {
  user_id: string;
  email_normalized: string;
  password_verifier_encrypted: string;
  password_verifier_iv: string;
  password_salt: string;
  password_iterations: number;
  failed_attempts: number;
  locked_until: string | null;
  password_reset_required: number | boolean;
};
type ProfileRow = {
  id: string;
  organization_id: string | null;
  role: string | null;
  client_id: string | null;
  full_name: string | null;
  phone: string | null;
  is_active: number | boolean;
  verified_at: string | null;
};
type SessionRow = {
  session_id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  last_seen_at: string | null;
  email_normalized: string;
  id: string;
  organization_id: string | null;
  role: string | null;
  client_id: string | null;
  full_name: string | null;
  phone: string | null;
  is_active: number | boolean;
  verified_at: string | null;
};

const COOKIE_NAME = 'customs_os_session';
const SESSION_SECONDS = 12 * 60 * 60;
const CHALLENGE_SECONDS = 120;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_IP_LIMIT = 20;
const USER_LOCK_THRESHOLD = 5;
const USER_LOCK_MS = 15 * 60 * 1000;
const PASSWORD_ITERATIONS = 310_000;
const ALLOWED_ROLES = new Set<Role>(['owner', 'admin', 'broker', 'accountant', 'warehouse', 'client']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
export const normalizeAuthEmail = (value: string) =>
  value.normalize('NFKC').trim().toLowerCase();
const validEmail = (value: string) =>
  value.length >= 3 && value.length <= 320 && EMAIL_PATTERN.test(value);
const isValidPepper = (value: string | undefined) =>
  typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);

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
  const fetchSite = request.headers.get('sec-fetch-site');
  return (origin === url.origin || (!origin && fetchSite === 'same-origin')) &&
    fetchSite !== 'cross-site';
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
    typeof row.verified_at !== 'string' || row.verified_at.length < 20 ||
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

function buildProofMessage(
  email: string,
  purpose: 'login' | 'password_change',
  challengeId: string,
  challenge: string,
) {
  return [
    'customs-os-auth-proof-v1',
    purpose,
    normalizeAuthEmail(email),
    challengeId.toLowerCase(),
    challenge.toLowerCase(),
  ].join('\n');
}

async function importPepperKey(pepper: string, usages: KeyUsage[]) {
  if (!isValidPepper(pepper)) throw new Error('AUTH_PEPPER_NOT_CONFIGURED');
  return crypto.subtle.importKey('raw', fromHex(pepper), { name: 'AES-GCM' }, false, usages);
}

export async function encryptCloudflareVerifierForStorage(
  pepper: string,
  userId: string,
  email: string,
  verifierHex: string,
) {
  if (!/^[0-9a-f]{64}$/i.test(verifierHex)) throw new Error('INVALID_PASSWORD_VERIFIER');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importPepperKey(pepper, ['encrypt']);
  const additionalData = encoder.encode(
    `customs-os-credential-v1\n${userId}\n${normalizeAuthEmail(email)}`,
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
    key,
    fromHex(verifierHex),
  );
  return {
    password_verifier_encrypted: toHex(new Uint8Array(ciphertext)),
    password_verifier_iv: toHex(iv),
  };
}

async function decryptStoredVerifier(
  pepper: string,
  credential: Pick<CredentialRow, 'user_id' | 'email_normalized' | 'password_verifier_encrypted' | 'password_verifier_iv'>,
) {
  if (!/^[0-9a-f]{96}$/i.test(credential.password_verifier_encrypted) ||
      !/^[0-9a-f]{24}$/i.test(credential.password_verifier_iv)) {
    throw new Error('INVALID_STORED_VERIFIER');
  }
  const key = await importPepperKey(pepper, ['decrypt']);
  const additionalData = encoder.encode(
    `customs-os-credential-v1\n${credential.user_id}\n${normalizeAuthEmail(credential.email_normalized)}`,
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromHex(credential.password_verifier_iv),
      additionalData,
      tagLength: 128,
    },
    key,
    fromHex(credential.password_verifier_encrypted),
  );
  const verifier = new Uint8Array(plaintext);
  if (verifier.length !== 32) throw new Error('INVALID_STORED_VERIFIER');
  return verifier;
}

async function verifyAuthProof(
  verifier: Uint8Array,
  proofHex: string,
  email: string,
  purpose: 'login' | 'password_change',
  challengeId: string,
  challenge: string,
) {
  if (!/^[0-9a-f]{64}$/i.test(proofHex)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    verifier,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    fromHex(proofHex),
    encoder.encode(buildProofMessage(email, purpose, challengeId, challenge)),
  );
}

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

async function ipIsRateLimited(db: CloudflareAuthDatabase, ipHash: string, now: number) {
  const prior = await db.prepare(
    'SELECT window_started_at, attempts FROM customs_os_auth_login_attempts WHERE ip_hash = ? LIMIT 1',
  ).bind(ipHash).first<{ window_started_at: string; attempts: number }>();
  return Boolean(
    prior &&
    Number.isFinite(Date.parse(prior.window_started_at)) &&
    now - Date.parse(prior.window_started_at) < LOGIN_WINDOW_MS &&
    Number(prior.attempts) >= LOGIN_IP_LIMIT,
  );
}

async function createChallengeRecord(
  db: CloudflareAuthDatabase,
  email: string,
  purpose: 'login' | 'password_change',
  ipHash: string,
  userId: string | null,
) {
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + CHALLENGE_SECONDS * 1000).toISOString();
  const challengeId = crypto.randomUUID();
  const challenge = secureToken();
  await db.prepare(
    'DELETE FROM customs_os_auth_challenges WHERE expires_at <= ? OR consumed_at IS NOT NULL',
  ).bind(createdAt).run();
  await db.prepare(
    'INSERT INTO customs_os_auth_challenges ' +
    '(challenge_id, user_id, email_normalized, purpose, challenge_hash, ip_hash, created_at, expires_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    challengeId, userId, email, purpose, await sha256(challenge), ipHash, createdAt, expiresAt,
  ).run();
  return {
    challenge_id: challengeId,
    challenge,
    expires_in: CHALLENGE_SECONDS,
  };
}

async function consumeChallenge(
  db: CloudflareAuthDatabase,
  challengeId: string,
  challenge: string,
  email: string,
  purpose: 'login' | 'password_change',
  ipHash: string,
  userId: string | null,
  nowIso: string,
) {
  if (!UUID_PATTERN.test(challengeId) || !/^[0-9a-f]{64}$/i.test(challenge)) return false;
  const result = await db.prepare(
    'UPDATE customs_os_auth_challenges SET consumed_at = ? ' +
    'WHERE challenge_id = ? AND email_normalized = ? AND purpose = ? ' +
    'AND challenge_hash = ? AND ip_hash = ? AND consumed_at IS NULL AND expires_at > ? ' +
    'AND (? IS NULL OR user_id = ?)',
  ).bind(
    nowIso, challengeId, email, purpose, await sha256(challenge), ipHash, nowIso, userId, userId,
  ).run();
  return Number(result.meta?.changes || 0) === 1;
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
    'INSERT INTO customs_os_auth_audit_events ' +
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

async function readActiveSession(db: CloudflareAuthDatabase, token: string, nowIso: string) {
  if (!token || token.length !== 64 || !/^[0-9a-f]{64}$/i.test(token)) return null;
  const tokenHash = await sha256(token);
  const row = await db.prepare(
    'SELECT s.session_id, s.user_id, s.token_hash, s.expires_at, s.last_seen_at, ' +
    'c.email_normalized, p.user_id AS id, p.organization_id, p.role, p.client_id, p.full_name, p.phone, p.is_active, p.verified_at ' +
    'FROM customs_os_auth_sessions s ' +
    'JOIN customs_os_auth_credentials c ON c.user_id = s.user_id ' +
    'JOIN customs_os_auth_principals p ON p.user_id = s.user_id ' +
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

async function createLoginChallenge(
  request: Request,
  db: CloudflareAuthDatabase,
  url: URL,
  env: CloudflareAuthEnvironment,
) {
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  if (!isValidPepper(env.AUTH_PEPPER)) return fail('AUTH_NOT_CONFIGURED', 503);
  let body: { email?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('INVALID_REQUEST', 400);
    body = parsed as { email?: unknown };
  } catch { return fail('INVALID_REQUEST', 400); }
  const email = typeof body.email === 'string' ? normalizeAuthEmail(body.email) : '';
  if (!validEmail(email)) return fail('INVALID_CREDENTIALS', 401);

  const now = Date.now();
  const ipHash = await sha256(request.headers.get('cf-connecting-ip') || 'unknown');
  if (await ipIsRateLimited(db, ipHash, now)) return fail('RATE_LIMITED', 429);
  const credential = await db.prepare(
    'SELECT user_id, email_normalized, password_salt, password_iterations ' +
    'FROM customs_os_auth_credentials WHERE email_normalized = ? LIMIT 1',
  ).bind(email).first<Pick<CredentialRow, 'user_id' | 'email_normalized' | 'password_salt' | 'password_iterations'>>();
  const salt = credential?.password_salt && /^[0-9a-f]{64}$/i.test(credential.password_salt)
    ? credential.password_salt
    : secureToken();
  const iterations = credential?.password_iterations === PASSWORD_ITERATIONS
    ? credential.password_iterations
    : PASSWORD_ITERATIONS;
  const challenge = await createChallengeRecord(db, email, 'login', ipHash, credential?.user_id || null);
  return json({ ...challenge, salt, iterations });
}

async function login(
  request: Request,
  db: CloudflareAuthDatabase,
  url: URL,
  env: CloudflareAuthEnvironment,
) {
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  if (!isValidPepper(env.AUTH_PEPPER)) return fail('AUTH_NOT_CONFIGURED', 503);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 8_192) return fail('REQUEST_TOO_LARGE', 413);

  let body: { email?: unknown; challenge_id?: unknown; challenge?: unknown; proof?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('INVALID_REQUEST', 400);
    body = parsed as typeof body;
  } catch { return fail('INVALID_REQUEST', 400); }
  const email = typeof body.email === 'string' ? normalizeAuthEmail(body.email) : '';
  const challengeId = typeof body.challenge_id === 'string' ? body.challenge_id : '';
  const challenge = typeof body.challenge === 'string' ? body.challenge : '';
  const proof = typeof body.proof === 'string' ? body.proof : '';
  if (!validEmail(email) || !UUID_PATTERN.test(challengeId) ||
      !/^[0-9a-f]{64}$/i.test(challenge) || !/^[0-9a-f]{64}$/i.test(proof)) {
    return fail('INVALID_CREDENTIALS', 401);
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const ipHash = await sha256(request.headers.get('cf-connecting-ip') || 'unknown');
  if (await ipIsRateLimited(db, ipHash, now)) return fail('RATE_LIMITED', 429);
  const consumed = await consumeChallenge(
    db, challengeId, challenge, email, 'login', ipHash, null, nowIso,
  );
  if (!consumed) {
    await recordIpFailure(db, ipHash, now);
    return fail('INVALID_CREDENTIALS', 401);
  }

  const credential = await db.prepare(
    'SELECT user_id, email_normalized, password_verifier_encrypted, password_verifier_iv, password_salt, ' +
    'password_iterations, failed_attempts, locked_until, password_reset_required ' +
    'FROM customs_os_auth_credentials WHERE email_normalized = ? LIMIT 1',
  ).bind(email).first<CredentialRow>();
  if (!credential || credential.locked_until && Date.parse(credential.locked_until) > now ||
      credential.password_iterations !== PASSWORD_ITERATIONS) {
    await recordIpFailure(db, ipHash, now);
    return fail('INVALID_CREDENTIALS', 401);
  }

  const verifier = await decryptStoredVerifier(env.AUTH_PEPPER, credential);
  const valid = await verifyAuthProof(verifier, proof, email, 'login', challengeId, challenge);
  if (!valid) {
    const failures = Number(credential.failed_attempts || 0) + 1;
    const lockedUntil = failures >= USER_LOCK_THRESHOLD
      ? new Date(now + USER_LOCK_MS).toISOString()
      : null;
    await db.prepare(
      'UPDATE customs_os_auth_credentials SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE user_id = ?',
    ).bind(failures, lockedUntil, nowIso, credential.user_id).run();
    await recordIpFailure(db, ipHash, now);
    return fail('INVALID_CREDENTIALS', 401);
  }

  const profileRow = await db.prepare(
    'SELECT user_id AS id, organization_id, role, client_id, full_name, phone, is_active, verified_at ' +
    'FROM customs_os_auth_principals WHERE user_id = ? LIMIT 1',
  ).bind(credential.user_id).first<ProfileRow>();
  const profile = parseProfile(profileRow, credential.user_id);
  if (!profile) return fail('ACCOUNT_NOT_READY_OR_DISABLED', 403);

  const token = secureToken();
  const tokenHash = await sha256(token);
  const sessionId = crypto.randomUUID();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + SESSION_SECONDS * 1000).toISOString();
  const label = deviceLabel((request.headers.get('user-agent') || '').slice(0, 500));
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
      'INSERT INTO customs_os_auth_audit_events ' +
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

async function createPasswordChangeChallenge(
  request: Request,
  db: CloudflareAuthDatabase,
  url: URL,
  env: CloudflareAuthEnvironment,
) {
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  if (!isValidPepper(env.AUTH_PEPPER)) return fail('AUTH_NOT_CONFIGURED', 503);
  const active = await readActiveSession(db, readCookie(request), new Date().toISOString());
  if (!active) return fail('UNAUTHORIZED', 401);
  const credential = await db.prepare(
    'SELECT password_salt, password_iterations FROM customs_os_auth_credentials WHERE user_id = ? LIMIT 1',
  ).bind(active.userId).first<{ password_salt: string; password_iterations: number }>();
  if (!credential || !/^[0-9a-f]{64}$/i.test(credential.password_salt) ||
      credential.password_iterations !== PASSWORD_ITERATIONS) return fail('AUTH_STORAGE_UNAVAILABLE', 503);
  const ipHash = await sha256(request.headers.get('cf-connecting-ip') || 'unknown');
  const challenge = await createChallengeRecord(
    db, active.email, 'password_change', ipHash, active.userId,
  );
  return json({ ...challenge, salt: credential.password_salt, iterations: credential.password_iterations });
}

async function changePassword(
  request: Request,
  db: CloudflareAuthDatabase,
  url: URL,
  env: CloudflareAuthEnvironment,
) {
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  if (!isValidPepper(env.AUTH_PEPPER)) return fail('AUTH_NOT_CONFIGURED', 503);
  const active = await readActiveSession(db, readCookie(request), new Date().toISOString());
  if (!active) return fail('UNAUTHORIZED', 401);
  let body: {
    challenge_id?: unknown;
    challenge?: unknown;
    proof?: unknown;
    new_verifier?: unknown;
    new_salt?: unknown;
    new_iterations?: unknown;
  };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('INVALID_REQUEST', 400);
    body = parsed as typeof body;
  } catch { return fail('INVALID_REQUEST', 400); }
  const challengeId = typeof body.challenge_id === 'string' ? body.challenge_id : '';
  const challenge = typeof body.challenge === 'string' ? body.challenge : '';
  const proof = typeof body.proof === 'string' ? body.proof : '';
  const newVerifier = typeof body.new_verifier === 'string' ? body.new_verifier : '';
  const newSalt = typeof body.new_salt === 'string' ? body.new_salt : '';
  const newIterations = Number(body.new_iterations);
  if (!UUID_PATTERN.test(challengeId) || !/^[0-9a-f]{64}$/i.test(challenge) ||
      !/^[0-9a-f]{64}$/i.test(proof) || !/^[0-9a-f]{64}$/i.test(newVerifier) ||
      !/^[0-9a-f]{64}$/i.test(newSalt) || newIterations !== PASSWORD_ITERATIONS) {
    return fail('INVALID_REQUEST', 400);
  }

  const now = new Date().toISOString();
  const ipHash = await sha256(request.headers.get('cf-connecting-ip') || 'unknown');
  const consumed = await consumeChallenge(
    db, challengeId, challenge, active.email, 'password_change', ipHash, active.userId, now,
  );
  if (!consumed) return fail('CURRENT_PASSWORD_INVALID', 401);

  const credential = await db.prepare(
    'SELECT user_id, email_normalized, password_verifier_encrypted, password_verifier_iv, password_salt, password_iterations ' +
    'FROM customs_os_auth_credentials WHERE user_id = ? LIMIT 1',
  ).bind(active.userId).first<CredentialRow>();
  if (!credential || credential.password_iterations !== PASSWORD_ITERATIONS) {
    return fail('AUTH_STORAGE_UNAVAILABLE', 503);
  }
  const verifier = await decryptStoredVerifier(env.AUTH_PEPPER, credential);
  if (!await verifyAuthProof(verifier, proof, active.email, 'password_change', challengeId, challenge)) {
    return fail('CURRENT_PASSWORD_INVALID', 401);
  }

  const encrypted = await encryptCloudflareVerifierForStorage(
    env.AUTH_PEPPER, active.userId, active.email, newVerifier,
  );
  const token = secureToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 500);
  const label = deviceLabel(userAgent);
  await db.batch([
    db.prepare(
      'UPDATE customs_os_auth_credentials SET password_verifier_encrypted = ?, password_verifier_iv = ?, ' +
      'password_salt = ?, password_iterations = ?, password_version = password_version + 1, ' +
      'failed_attempts = 0, locked_until = NULL, password_reset_required = 0, ' +
      'password_changed_at = ?, updated_at = ? WHERE user_id = ?',
    ).bind(
      encrypted.password_verifier_encrypted, encrypted.password_verifier_iv,
      newSalt, newIterations, now, now, active.userId,
    ),
    db.prepare(
      'UPDATE customs_os_auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND token_hash <> ?',
    ).bind(now, active.userId, active.tokenHash),
    db.prepare(
      'UPDATE customs_os_auth_sessions SET token_hash = ?, created_at = ?, expires_at = ?, last_seen_at = ?, device_label = ? WHERE token_hash = ? AND revoked_at IS NULL',
    ).bind(tokenHash, now, expiresAt, now, label, active.tokenHash),
    db.prepare(
      'INSERT INTO customs_os_auth_audit_events ' +
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
    const target = await db.prepare(
      'SELECT session_id FROM customs_os_auth_sessions WHERE user_id = ? AND session_id = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1',
    ).bind(active.userId, targetId, new Date().toISOString()).first<{ session_id: string }>();
    if (!target) return fail('DEVICE_SESSION_NOT_FOUND', 404);
    const changed = await db.prepare(
      'UPDATE customs_os_auth_sessions SET revoked_at = ? WHERE user_id = ? AND session_id = ? AND revoked_at IS NULL',
    ).bind(new Date().toISOString(), active.userId, targetId).run();
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
  env: CloudflareAuthEnvironment = {},
): Promise<Response> {
  try {
    if (url.pathname === '/api/auth/challenge') return await createLoginChallenge(request, db, url, env);
    if (url.pathname === '/api/auth/login') return await login(request, db, url, env);
    if (url.pathname === '/api/auth/session') return await getSession(request, db, url);
    if (url.pathname === '/api/auth/logout') return await logout(request, db, url);
    if (url.pathname === '/api/auth/password/challenge') return await createPasswordChangeChallenge(request, db, url, env);
    if (url.pathname === '/api/auth/password/change') return await changePassword(request, db, url, env);
    if (url.pathname === '/api/auth/devices' || url.pathname.startsWith('/api/auth/devices/')) {
      return await devices(request, db, url);
    }
    return fail('NOT_FOUND', 404);
  } catch (error) {
    if (error instanceof Error && error.message === 'AUTH_PEPPER_NOT_CONFIGURED') {
      return fail('AUTH_NOT_CONFIGURED', 503);
    }
    return fail('AUTH_STORAGE_UNAVAILABLE', 503);
  }
}
