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
const PASSWORD_ITERATIONS = 600_000;
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

async function createUnknownAccountSalt(pepper: string, email: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    fromHex(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode('customs-os-unknown-account-salt-v1\n' + normalizeAuthEmail(email)),
  );
  return toHex(new Uint8Array(digest));
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
    : await createUnknownAccountSalt(env.AUTH_PEPPER!, email);
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
  const credential = await db.prepare(
    'SELECT user_id, email_normalized, password_verifier_encrypted, password_verifier_iv, password_salt, ' +
    'password_iterations, failed_attempts, locked_until, password_reset_required ' +
    'FROM customs_os_auth_credentials WHERE email_normalized = ? LIMIT 1',
  ).bind(email).first<CredentialRow>();
  const consumed = await consumeChallenge(
    db, challengeId, challenge, email, 'login', ipHash, credential?.user_id || null, nowIso,
  );
  if (!consumed) {
    await recordIpFailure(db, ipHash, now);
    return fail('INVALID_CREDENTIALS', 401);
  }
