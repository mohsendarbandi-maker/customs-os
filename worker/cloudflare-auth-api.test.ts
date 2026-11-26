import { describe, expect, it } from 'vitest';
import {
  createCloudflarePasswordCredential,
  handleCloudflareAuthApi,
  normalizeAuthEmail,
  verifyCloudflarePassword,
  type CloudflareAuthDatabase,
  type CloudflareAuthStatement,
} from './cloudflare-auth-api';

type TestCredential = {
  user_id: string;
  email_normalized: string;
  password_hash: string;
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

class MemoryAuthD1 implements CloudflareAuthDatabase {
  credential: TestCredential | null = null;
  principal: TestPrincipal | null = null;
  sessions: TestSession[] = [];
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
          return (db.credential?.email_normalized === values[0] ? db.credential : null) as T | null;
        }
        if (sql.includes('FROM customs_os_auth_principals WHERE user_id')) {
          return (db.principal?.user_id === values[0] ? { ...db.principal, id: db.principal.user_id } : null) as T | null;
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
          db.sessions.push({ session_id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at: null, device_label, app_origin });
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

const unusedDatabase = (): CloudflareAuthDatabase => ({
  prepare() { throw new Error('database should not be touched'); },
  async batch() { throw new Error('database should not be touched'); },
});

const makeReadyDatabase = async () => {
  const db = new MemoryAuthD1();
  const credential = await createCloudflarePasswordCredential('Strong-Password-2026!');
  db.credential = {
    user_id: 'owner-1',
    email_normalized: 'owner@example.com',
    ...credential,
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

const loginRequest = (email = 'OWNER@example.com', password = 'Strong-Password-2026!') =>
  new Request('https://darbandicommercial.ir/api/auth/login', {
    method: 'POST',
    headers: {
      origin: 'https://darbandicommercial.ir',
      'content-type': 'application/json',
      'cf-connecting-ip': '192.0.2.10',
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    },
    body: JSON.stringify({ email, password }),
  });

describe('Cloudflare D1 authentication primitives', () => {
  it('normalizes Unicode-compatible email casing and whitespace', () => {
    expect(normalizeAuthEmail('  OWNER@Example.COM  ')).toBe('owner@example.com');
  });

  it('creates salted PBKDF2-SHA-256 credentials and verifies only the matching password', async () => {
    const credential = await createCloudflarePasswordCredential('Strong-Password-2026!');
    expect(credential.password_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(credential.password_salt).toMatch(/^[0-9a-f]{64}$/);
    expect(credential.password_iterations).toBe(310_000);
    await expect(
      verifyCloudflarePassword(
        'Strong-Password-2026!',
        credential.password_hash,
        credential.password_salt,
        credential.password_iterations,
      ),
    ).resolves.toBe(true);
    await expect(
      verifyCloudflarePassword(
        'Wrong-Password-2026!',
        credential.password_hash,
        credential.password_salt,
        credential.password_iterations,
      ),
    ).resolves.toBe(false);
  });

  it('rejects short passwords at credential creation time', async () => {
    await expect(createCloudflarePasswordCredential('short')).rejects.toThrow('PASSWORD_POLICY');
  });

  it('rejects weak or malformed stored PBKDF2 parameters without deriving a key', async () => {
    await expect(verifyCloudflarePassword('test', 'bad-hash', 'a'.repeat(64), 310_000)).resolves.toBe(false);
    await expect(verifyCloudflarePassword('test', 'a'.repeat(64), 'b'.repeat(64), 1)).resolves.toBe(false);
    await expect(verifyCloudflarePassword('test', 'a'.repeat(64), 'b'.repeat(64), 1_000_001)).resolves.toBe(false);
  });
});

describe('Cloudflare D1 authentication HTTP boundary', () => {
  it('rejects cross-origin login before accessing the database', async () => {
    const request = new Request('https://darbandicommercial.ir/api/auth/login', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'owner@example.com', password: 'irrelevant' }),
    });
    const response = await handleCloudflareAuthApi(
      request,
      unusedDatabase(),
      new URL(request.url),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: 'ORIGIN_FORBIDDEN' });
  });

  it('creates a tenant-scoped session for a verified active account and restores it', async () => {
    const db = await makeReadyDatabase();
    const loginResponse = await handleCloudflareAuthApi(
      loginRequest(),
      db,
      new URL('https://darbandicommercial.ir/api/auth/login'),
    );
    expect(loginResponse.status).toBe(200);
    const loginBody = await loginResponse.json() as { authenticated: boolean; profile: { organization_id: string; role: string }; session_id: string };
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
    );
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({
      authenticated: true,
      user: { id: 'owner-1', email: 'owner@example.com' },
      profile: { organization_id: 'org-1', role: 'owner' },
    });
  });

  it('does not create a session for a disabled profile', async () => {
    const db = await makeReadyDatabase();
    db.principal!.is_active = 0;
    const response = await handleCloudflareAuthApi(
      loginRequest(),
      db,
      new URL('https://darbandicommercial.ir/api/auth/login'),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'ACCOUNT_NOT_READY_OR_DISABLED' });
    expect(db.sessions).toHaveLength(0);
  });

  it('returns an unauthenticated session without querying D1 when no cookie exists', async () => {
    const request = new Request('https://darbandicommercial.ir/api/auth/session');
    const response = await handleCloudflareAuthApi(
      request,
      unusedDatabase(),
      new URL(request.url),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it('does not expose internal D1 errors to the caller', async () => {
    const brokenDatabase: CloudflareAuthDatabase = {
      prepare() { throw new Error('private sql internals'); },
      async batch() { throw new Error('private sql internals'); },
    };
    const request = loginRequest();
    const response = await handleCloudflareAuthApi(
      request,
      brokenDatabase,
      new URL(request.url),
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('AUTH_STORAGE_UNAVAILABLE');
    expect(body).not.toContain('private sql internals');
  });

  it('returns a 404 for unsupported auth routes', async () => {
    const request = new Request('https://darbandicommercial.ir/api/auth/unexpected');
    const response = await handleCloudflareAuthApi(
      request,
      unusedDatabase(),
      new URL(request.url),
    );
    expect(response.status).toBe(404);
  });
});
