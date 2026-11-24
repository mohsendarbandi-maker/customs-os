import { describe, expect, it } from 'vitest';
import {
  handleDeviceSessionsApi,
  type DeviceSessionsDatabase,
  type DeviceSessionsStatement,
} from './device-sessions-api';

type SessionRow = {
  token_hash: string;
  user_id: string;
  session_id: string;
  device_label: string;
  app_origin: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

class FakeStatement implements DeviceSessionsStatement {
  values: unknown[] = [];
  constructor(readonly sql: string, private readonly db: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.values);
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return this.db.all<T>(this.sql, this.values);
  }
  async run(): Promise<{ meta?: { changes?: number } }> {
    return this.db.run(this.sql, this.values);
  }
}

class FakeD1 implements DeviceSessionsDatabase {
  sessions: SessionRow[] = [];
  events: Array<Record<string, unknown>> = [];
  queries: Array<{ sql: string; values: unknown[] }> = [];
  prepare(sql: string) { return new FakeStatement(sql, this); }

  async batch(statements: DeviceSessionsStatement[]) {
    const results: Array<{ meta: { changes: number } }> = [];
    let priorChanges = 0;
    for (const statement of statements as FakeStatement[]) {
      const result = await statement.run();
      priorChanges = result.meta?.changes || 0;
      results.push({ meta: { changes: priorChanges } });
    }
    return results;
  }

  first<T>(sql: string, values: unknown[]): T | null {
    this.queries.push({ sql, values });
    if (sql.includes('SELECT session_id FROM customs_admin_sessions')) {
      const [userId, sessionId, now] = values as string[];
      const found = this.sessions.find((item) =>
        item.user_id === userId && item.session_id === sessionId &&
        item.revoked_at === null && item.expires_at > now
      );
      return (found ? { session_id: found.session_id } : null) as T | null;
    }
    throw new Error('Unexpected first query: ' + sql);
  }

  all<T>(sql: string, values: unknown[]): { results: T[] } {
    this.queries.push({ sql, values });
    if (sql.includes('FROM customs_admin_sessions') && sql.includes('AS is_current')) {
      const [currentTokenHash, userId, now] = values as string[];
      const results = this.sessions
        .filter((item) => item.user_id === userId && item.revoked_at === null && item.expires_at > now)
        .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))
        .slice(0, 50)
        .map((item) => ({
          session_id: item.session_id,
          device_label: item.device_label,
          app_origin: item.app_origin,
          created_at: item.created_at,
          last_active_at: item.last_seen_at,
          is_current: item.token_hash === currentTokenHash ? 1 : 0,
          user_agent: null,
          revoke_requested_at: null,
        }));
      return { results: results as T[] };
    }
    throw new Error('Unexpected all query: ' + sql);
  }

  async run(sql: string, values: unknown[]): Promise<{ meta?: { changes?: number } }> {
    this.queries.push({ sql, values });
    if (sql.startsWith('UPDATE customs_admin_sessions SET revoked_at = ?') &&
        sql.includes('token_hash <> ?')) {
      const [revokedAt, userId, currentTokenHash, now] = values as string[];
      let changes = 0;
      for (const session of this.sessions) {
        if (session.user_id === userId && session.token_hash !== currentTokenHash &&
            session.revoked_at === null && session.expires_at > now) {
          session.revoked_at = revokedAt;
          changes += 1;
        }
      }
      this.lastChanges = changes;
      return { meta: { changes } };
    }
    if (sql.startsWith('UPDATE customs_admin_sessions SET revoked_at = ?') &&
        sql.includes('session_id = ?')) {
      const [revokedAt, userId, sessionId, currentSessionId, now] = values as string[];
      let changes = 0;
      for (const session of this.sessions) {
        if (session.user_id === userId && session.session_id === sessionId &&
            session.session_id !== currentSessionId && session.revoked_at === null &&
            session.expires_at > now) {
          session.revoked_at = revokedAt;
          changes += 1;
        }
      }
      this.lastChanges = changes;
      return { meta: { changes } };
    }
    if (sql.startsWith('INSERT INTO customs_os_auth_events')) {
      if ((sql.includes('WHERE changes() > 0') && this.lastChanges > 0) ||
          (sql.includes('WHERE changes() > 0') && this.lastChanges === 0)) {
        if (this.lastChanges > 0) this.events.push({ values, sql });
      }
      return { meta: { changes: this.lastChanges > 0 ? 1 : 0 } };
    }
    throw new Error('Unexpected run query: ' + sql);
  }
  private lastChanges = 0;
}

const current = {
  user_id: 'owner-a',
  token_hash: 'token-current-hash',
  session_id: '550e8400-e29b-41d4-a716-446655440000',
};
const active = (overrides: Partial<SessionRow> = {}): SessionRow => ({
  token_hash: 'token-other-hash',
  user_id: 'owner-a',
  session_id: '550e8400-e29b-41d4-a716-446655440001',
  device_label: 'iPhone',
  app_origin: 'https://staging.example',
  created_at: '2026-11-20T10:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  last_seen_at: '2026-11-21T10:00:00.000Z',
  revoked_at: null,
  ...overrides,
});

const request = (method: string, path: string, body?: unknown) => new Request(
  'https://staging.example' + path,
  {
    method,
    headers: {
      origin: 'https://staging.example',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  },
);

describe('Cloudflare D1 device session API', () => {
  it('lists only the authenticated user’s active sessions without exposing token hashes', async () => {
    const db = new FakeD1();
    db.sessions.push(
      active(),
      active({ token_hash: current.token_hash, session_id: current.session_id, device_label: 'این دستگاه' }),
      active({ token_hash: 'foreign-token', user_id: 'owner-b', session_id: '550e8400-e29b-41d4-a716-446655440002' }),
      active({ token_hash: 'revoked-token', session_id: '550e8400-e29b-41d4-a716-446655440003', revoked_at: '2026-11-22T00:00:00.000Z' }),
    );
    const url = new URL('https://staging.example/api/auth/devices');
    const response = await handleDeviceSessionsApi(request('GET', url.pathname), db, url, current);
    const body = await response.json() as { sessions: Array<Record<string, unknown>> };
    expect(response.status).toBe(200);
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.filter((row) => row.is_current === true || row.is_current === 1)).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('token-current-hash');
    expect(JSON.stringify(body)).not.toContain('foreign-token');
  });

  it('revokes one other device and records a security audit event', async () => {
    const db = new FakeD1();
    db.sessions.push(active());
    const url = new URL('https://staging.example/api/auth/devices/550e8400-e29b-41d4-a716-446655440001');
    const response = await handleDeviceSessionsApi(request('DELETE', url.pathname), db, url, current);
    const body = await response.json() as { ok: boolean; revoked_count: number };
    expect(response.status).toBe(200);
    expect(body.revoked_count).toBe(1);
    expect(db.sessions[0].revoked_at).not.toBeNull();
    expect(db.events).toHaveLength(1);
  });

  it('refuses to revoke the current session through the device endpoint', async () => {
    const db = new FakeD1();
    db.sessions.push(active({ token_hash: current.token_hash, session_id: current.session_id }));
    const url = new URL('https://staging.example/api/auth/devices/' + current.session_id);
    const response = await handleDeviceSessionsApi(request('DELETE', url.pathname), db, url, current);
    expect(response.status).toBe(409);
    expect(db.sessions[0].revoked_at).toBeNull();
  });

  it('revokes all other active sessions while preserving the current one', async () => {
    const db = new FakeD1();
    db.sessions.push(
      active(),
      active({ token_hash: 'other-2', session_id: '550e8400-e29b-41d4-a716-446655440004' }),
      active({ token_hash: current.token_hash, session_id: current.session_id }),
    );
    const url = new URL('https://staging.example/api/auth/devices/revoke-others');
    const response = await handleDeviceSessionsApi(request('POST', url.pathname), db, url, current);
    const body = await response.json() as { ok: boolean; revoked_count: number };
    expect(response.status).toBe(200);
    expect(body.revoked_count).toBe(2);
    expect(db.sessions.find((row) => row.token_hash === current.token_hash)?.revoked_at).toBeNull();
    expect(db.sessions.filter((row) => row.revoked_at !== null)).toHaveLength(2);
    expect(db.events).toHaveLength(1);
  });

  it('rejects cross-origin mutation requests', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/auth/devices/revoke-others');
    const crossOrigin = new Request(url, { method: 'POST', headers: { origin: 'https://evil.example' } });
    const response = await handleDeviceSessionsApi(crossOrigin, db, url, current);
    expect(response.status).toBe(403);
    expect(db.sessions).toHaveLength(0);
  });
});
