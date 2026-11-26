import { describe, expect, it } from 'vitest';
import {
  createCloudflareAuthProof,
  deriveCloudflarePasswordVerifier,
  type CloudflareAuthChallenge,
} from '../src/lib/cloudflareAuthCrypto';
import {
  encryptCloudflareVerifierForStorage,
  handleCloudflareAuthApi,
  type CloudflareAuthDatabase,
  type CloudflareAuthStatement,
} from './cloudflare-auth-api';

const TEST_PEPPER = 'ab'.repeat(32);
const TEST_IP = '192.0.2.10';

type TestCredential = {
  user_id: string;
  email_normalized: string;
  password_verifier_encrypted: string;
  password_verifier_iv: string;
  password_salt: string;
  password_iterations: number;
  failed_attempts: number;
  locked_until: string | null;
  password_reset_required: number;
};
type TestPrincipal = {
  user_id: string;
  organization_id: string;
  role: string;
  client_id: string | null;
  full_name: string;
  phone: string | null;
  is_active: number;
  verified_at: string | null;
};
type TestSession = {
  session_id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  device_label: string;
  app_origin: string;
};
type TestChallenge = {
  challenge_id: string;
  user_id: string | null;
  email_normalized: string;
  purpose: 'login' | 'password_change';
  challenge_hash: string;
  ip_hash: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

class MemoryAuthD1 implements CloudflareAuthDatabase {
  credential: TestCredential | null = null;
  principal: TestPrincipal | null = null;
  sessions: TestSession[] = [];
  challenges: TestChallenge[] = [];
  attempts = new Map<string, { window_started_at: string; attempts: number }>();
  audit: Array<{ event_type: string; target_user_id: string }> = [];

  prepare(sql: string): CloudflareAuthStatement {
    const db = this;
    let values: unknown[] = [];
    return {
      bind(...input: unknown[]) { values = input; return this; },
      async first<T>() {
        if (sql.includes('FROM customs_os_auth_login_attempts')) {
          return (db.attempts.get(String(values[0])) ?? null) as T | null;
        }
        if (sql.includes('FROM customs_os_auth_credentials WHERE email_normalized')) {
          const email = String(values[0]);
          if (!db.credential || db.credential.email_normalized !== email) return null;
          if (sql.includes('password_verifier_encrypted')) return db.credential as T;
          return {
            user_id: db.credential.user_id,
            email_normalized: db.credential.email_normalized,
            password_salt: db.credential.password_salt,
            password_iterations: db.credential.password_iterations,
          } as T;
        }
        if (sql.includes('FROM customs_os_auth_credentials WHERE user_id')) {
          if (!db.credential || db.credential.user_id !== values[0]) return null;
          return db.credential as T;
        }
        if (sql.includes('FROM customs_os_auth_principals WHERE user_id')) {
          return (db.principal?.user_id === values[0]
            ? { ...db.principal, id: db.principal.user_id }
            : null) as T | null;
        }
        if (sql.includes('FROM customs_os_auth_sessions s')) {
          const [tokenHash, nowIso] = values as string[];
          const session = db.sessions.find(item =>
            item.token_hash === tokenHash && item.revoked_at === null && item.expires_at > nowIso
          );
          if (!session || !db.credential || !db.principal) return null;
          return {
            session_id: session.session_id,
            user_id: session.user_id,
            token_hash: session.token_hash,
            expires_at: session.expires_at,
            last_seen_at: session.last_seen_at,
            email_normalized: db.credential.email_normalized,
            id: db.principal.user_id,
            organization_id: db.principal.organization_id,
            role: db.principal.role,
            client_id: db.principal.client_id,
            full_name: db.principal.full_name,
            phone: db.principal.phone,
            is_active: db.principal.is_active,
            verified_at: db.principal.verified_at,
          } as T;
        }
        if (sql.includes('SELECT password_reset_required FROM customs_os_auth_credentials')) {
          return db.credential as T | null;
        }
        throw new Error('Unexpected auth D1 first query: ' + sql);
      },
      async all<T>() {
        if (sql.includes('FROM customs_os_auth_sessions WHERE user_id')) {
          const [currentHash, userId, now] = values as string[];
          const results = db.sessions
            .filter(item => item.user_id === userId && !item.revoked_at && item.expires_at > now)
            .map(item => ({
              session_id: item.session_id,
              device_label: item.device_label,
              app_origin: item.app_origin,
              created_at: item.created_at,
              last_seen_at: item.last_seen_at,
              is_current: item.token_hash === currentHash ? 1 : 0,
            }));
          return { results: results as T[] };
        }
        throw new Error('Unexpected auth D1 all query: ' + sql);
      },
      async run() {
        if (sql.startsWith('DELETE FROM customs_os_auth_challenges')) {
          db.challenges = db.challenges.filter(item =>
            item.expires_at > String(values[0]) && item.consumed_at === null
          );
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('INSERT INTO customs_os_auth_challenges')) {
          const [challenge_id, user_id, email_normalized, purpose, challenge_hash, ip_hash, created_at, expires_at] = values as [
            string, string | null, string, 'login' | 'password_change', string, string, string, string
          ];
          db.challenges.push({
            challenge_id, user_id, email_normalized, purpose, challenge_hash, ip_hash,
            created_at, expires_at, consumed_at: null,
          });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('UPDATE customs_os_auth_challenges SET consumed_at')) {
          const [consumedAt, challengeId, email, purpose, challengeHash, ipHash, now, userId] = values as [
            string, string, string, string, string, string, string, string | null
          ];
          const challenge = db.challenges.find(item =>
            item.challenge_id === challengeId &&
            item.email_normalized === email &&
            item.purpose === purpose &&
            item.challenge_hash === challengeHash &&
            item.ip_hash === ipHash &&
            item.consumed_at === null &&
            item.expires_at > now &&
            (userId === null || item.user_id === userId)
          );
          if (challenge) challenge.consumed_at = consumedAt;
          return { meta: { changes: challenge ? 1 : 0 } };
        }
        if (sql.startsWith('UPDATE customs_os_auth_credentials SET failed_attempts = ?')) {
          if (db.credential) {
            db.credential.failed_attempts = Number(values[0]);
            db.credential.locked_until = values[1] as string | null;
          }
          return { meta: { changes: db.credential ? 1 : 0 } };
        }
        if (sql.startsWith('UPDATE customs_os_auth_credentials SET failed_attempts = 0')) {
          if (db.credential) {
            db.credential.failed_attempts = 0;
            db.credential.locked_until = null;
          }
          return { meta: { changes: db.credential ? 1 : 0 } };
        }
        if (sql.startsWith('INSERT INTO customs_os_auth_sessions')) {
          const [session_id, user_id, token_hash, created_at, expires_at, last_seen_at, device_label, app_origin] = values as string[];
          db.sessions.push({
            session_id, user_id, token_hash, created_at, expires_at, last_seen_at,
            revoked_at: null, device_label, app_origin,
          });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('DELETE FROM customs_os_auth_login_attempts')) {
          db.attempts.delete(String(values[0]));
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('INSERT INTO customs_os_auth_login_attempts')) {
          const [ipHash, windowStartedAt] = values as string[];
          db.attempts.set(ipHash, { window_started_at: windowStartedAt, attempts: 1 });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('UPDATE customs_os_auth_login_attempts')) {
          const ipHash = String(values[0]);
          const previous = db.attempts.get(ipHash);
          if (previous) previous.attempts = Math.min(previous.attempts + 1, 100);
          return { meta: { changes: previous ? 1 : 0 } };
        }
        if (sql.startsWith('INSERT INTO customs_os_auth_audit_events')) {
          db.audit.push({ event_type: String(values[3]), target_user_id: String(values[2]) });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('UPDATE customs_os_auth_sessions SET last_seen_at')) {
          const [lastSeen, tokenHash] = values as string[];
          const session = db.sessions.find(item => item.token_hash === tokenHash);
          if (session) session.last_seen_at = lastSeen;
          return { meta: { changes: session ? 1 : 0 } };
        }
        if (sql.startsWith('UPDATE customs_os_auth_sessions SET revoked_at')) {
          const [revokedAt, tokenHash] = values as string[];
          const session = db.sessions.find(item => item.token_hash === tokenHash);
          if (session) session.revoked_at = revokedAt;
          return { meta: { changes: session ? 1 : 0 } };
        }
        throw new Error('Unexpected auth D1 run query: ' + sql);
      },
    };
  }

  async batch(statements: CloudflareAuthStatement[]) {
    const results: Array<{ meta: { changes: number } }> = [];
    for (const statement of statements) {
      const result = await statement.run();
      results.push({ meta: { changes: Number(result.meta?.changes || 0) } });
    }
    return results;
  }
}

const makeReadyDatabase = async () => {
  const db = new MemoryAuthD1();
  const verifier = await deriveCloudflarePasswordVerifier('Strong-Password-2026!');
  const encrypted = await encryptCloudflareVerifierForStorage(
    TEST_PEPPER, 'owner-1', 'owner@example.com', verifier.verifier,
  );
  db.credential = {
    user_id: 'owner-1',
    email_normalized: 'owner@example.com',
    ...encrypted,
    password_salt: verifier.salt,
    password_iterations: verifier.iterations,
    failed_attempts: 0,
    locked_until: null,
    password_reset_required: 0,
  };
  db.principal = {
    user_id: 'owner-1',
    organization_id: 'org-1',
    role: 'owner',
    client_id: null,
    full_name: 'مدیر سامانه',
    phone: null,
    is_active: 1,
    verified_at: '2026-11-26T00:00:00.000Z',
  };
  return db;
};

const makeChallenge = async (db: CloudflareAuthDatabase) => {
  const request = new Request('https://darbandicommercial.ir/api/auth/challenge', {
    method: 'POST',
    headers: {
      origin: 'https://darbandicommercial.ir',
      'content-type': 'application/json',
      'cf-connecting-ip': TEST_IP,
    },
    body: JSON.stringify({ email: 'OWNER@example.com' }),
  });
  const response = await handleCloudflareAuthApi(
    request, db, new URL(request.url), { AUTH_PEPPER: TEST_PEPPER },
  );
  if (!response.ok) throw new Error('Could not create login challenge: ' + response.status);
  return await response.json() as CloudflareAuthChallenge;
};

const completeLogin = async (db: CloudflareAuthDatabase, challenge: CloudflareAuthChallenge) => {
  const email = 'OWNER@example.com';
  const proof = await createCloudflareAuthProof(email, 'login', challenge, 'Strong-Password-2026!');
  const request = new Request('https://darbandicommercial.ir/api/auth/login', {
    method: 'POST',
    headers: {
      origin: 'https://darbandicommercial.ir',
      'content-type': 'application/json',
      'cf-connecting-ip': TEST_IP,
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    },
    body: JSON.stringify({
      email,
      challenge_id: challenge.challenge_id,
      challenge: challenge.challenge,
      proof,
    }),
  });
  return handleCloudflareAuthApi(
    request, db, new URL(request.url), { AUTH_PEPPER: TEST_PEPPER },
  );
};

describe('Cloudflare browser-side auth cryptography', () => {
  it('derives fixed-cost PBKDF2 verifiers without sending a plaintext password to the Worker', async () => {
    const verifier = await deriveCloudflarePasswordVerifier('Strong-Password-2026!');
    expect(verifier.verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(verifier.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(verifier.iterations).toBe(310_000);
  });

  it('generates a one-time HMAC proof bound to the email, purpose, and UUID challenge', async () => {
    const challenge: CloudflareAuthChallenge = {
      challenge_id: '550e8400-e29b-41d4-a716-446655440000',
      challenge: 'a'.repeat(64),
      salt: 'b'.repeat(64),
      iterations: 310_000,
      expires_in: 120,
    };
    const proof = await createCloudflareAuthProof(' Owner@Example.com ', 'login', challenge, 'Strong-Password-2026!');
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects unsupported work factors and weak passwords in the browser helper', async () => {
    await expect(deriveCloudflarePasswordVerifier('short')).rejects.toThrow('PASSWORD_POLICY');
    await expect(deriveCloudflarePasswordVerifier('Strong-Password-2026!', 'b'.repeat(64), 100_000))
      .rejects.toThrow('UNSUPPORTED_PASSWORD_KDF');
  });
});

describe('Cloudflare D1 authentication HTTP boundary', () => {
  it('rejects cross-origin login before accessing the database', async () => {
    const request = new Request('https://darbandicommercial.ir/api/auth/challenge', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'owner@example.com' }),
    });
    const response = await handleCloudflareAuthApi(
      request,
      { prepare() { throw new Error('database should not be touched'); }, async batch() { throw new Error('database should not be touched'); } },
      new URL(request.url),
      { AUTH_PEPPER: TEST_PEPPER },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: 'ORIGIN_FORBIDDEN' });
  });

  it('creates a tenant-scoped session for a verified active account and restores it from a subdomain', async () => {
    const db = await makeReadyDatabase();
    const challenge = await makeChallenge(db);
    const loginResponse = await completeLogin(db, challenge);
    expect(loginResponse.status).toBe(200);
    const loginBody = await loginResponse.json() as {
      authenticated: boolean;
      profile: { organization_id: string; role: string };
      session_id: string;
    };
    expect(loginBody.authenticated).toBe(true);
    expect(loginBody.profile).toMatchObject({ organization_id: 'org-1', role: 'owner' });
    expect(db.sessions).toHaveLength(1);
    expect(db.audit.map(item => item.event_type)).toContain('login');

    const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toMatch(/^customs_os_session=[0-9a-f]{64}$/);
    expect(loginResponse.headers.get('set-cookie')).toContain('HttpOnly');
    expect(loginResponse.headers.get('set-cookie')).toContain('Secure');

    const sessionRequest = new Request('https://chat.darbandicommercial.ir/api/auth/session', {
      headers: { cookie },
    });
    const sessionResponse = await handleCloudflareAuthApi(
      sessionRequest,
      db,
      new URL(sessionRequest.url),
      { AUTH_PEPPER: TEST_PEPPER },
    );
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({
      authenticated: true,
      user: { id: 'owner-1', email: 'owner@example.com' },
      profile: { organization_id: 'org-1', role: 'owner' },
    });

    const replay = await completeLogin(db, challenge);
    expect(replay.status).toBe(401);
  });

  it('does not create a session for a disabled profile', async () => {
    const db = await makeReadyDatabase();
    db.principal!.is_active = 0;
    const challenge = await makeChallenge(db);
    const response = await completeLogin(db, challenge);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'ACCOUNT_NOT_READY_OR_DISABLED' });
    expect(db.sessions).toHaveLength(0);
  });

  it('does not expose internal D1 errors to the caller', async () => {
    const brokenDatabase: CloudflareAuthDatabase = {
      prepare() { throw new Error('private sql internals'); },
      async batch() { throw new Error('private sql internals'); },
    };
    const request = new Request('https://darbandicommercial.ir/api/auth/challenge', {
      method: 'POST',
      headers: { origin: 'https://darbandicommercial.ir', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com' }),
    });
    const response = await handleCloudflareAuthApi(
      request,
      brokenDatabase,
      new URL(request.url),
      { AUTH_PEPPER: TEST_PEPPER },
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('AUTH_STORAGE_UNAVAILABLE');
    expect(body).not.toContain('private sql internals');
  });

  it('fails closed when the Worker-side encryption secret is missing', async () => {
    const request = new Request('https://darbandicommercial.ir/api/auth/challenge', {
      method: 'POST',
      headers: { origin: 'https://darbandicommercial.ir', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com' }),
    });
    const response = await handleCloudflareAuthApi(
      request,
      { prepare() { throw new Error('must not access D1'); }, async batch() { throw new Error('must not access D1'); } },
      new URL(request.url),
      {},
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'AUTH_NOT_CONFIGURED' });
  });

  it('returns an unauthenticated session without querying D1 when no cookie exists', async () => {
    const request = new Request('https://darbandicommercial.ir/api/auth/session');
    const response = await handleCloudflareAuthApi(
      request,
      { prepare() { throw new Error('database should not be touched'); }, async batch() { throw new Error('database should not be touched'); } },
      new URL(request.url),
      { AUTH_PEPPER: TEST_PEPPER },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it('returns a 404 for unsupported auth routes', async () => {
    const request = new Request('https://darbandicommercial.ir/api/auth/unexpected');
    const response = await handleCloudflareAuthApi(
      request,
      { prepare() { throw new Error('database should not be touched'); }, async batch() { throw new Error('database should not be touched'); } },
      new URL(request.url),
      { AUTH_PEPPER: TEST_PEPPER },
    );
    expect(response.status).toBe(404);
  });
});
