import { afterEach, describe, expect, it, vi } from 'vitest';
import migrationWorker from './migration-staging';

const origin = 'https://customs-os-migration-staging.mohsen-darbandi.workers.dev';
const endpoint = origin + '/functions/v1/sync-vessel-ais';
const token = 'aisfriends-route-session-token';

const hash = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

class Statement {
  private values: unknown[] = [];
  constructor(
    private readonly sql: string,
    private readonly tokenHash: string,
    private readonly session: Record<string, unknown>,
    private readonly rows: Array<Record<string, unknown>>,
    private readonly updates: Array<{ sql: string; values: unknown[] }>,
  ) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() {
    if (this.sql.includes('FROM customs_admin_sessions') && this.values[0] === this.tokenHash) {
      return this.session as T;
    }
    return null;
  }
  async all<T>() {
    if (this.sql.includes('FROM vessels')) return { results: this.rows as T[] };
    return { results: [] as T[] };
  }
  async run() {
    this.updates.push({ sql: this.sql, values: this.values });
    return { meta: { changes: 1 } };
  }
}

const environment = async () => {
  const tokenHash = await hash(token);
  const updates: Array<{ sql: string; values: unknown[] }> = [];
  const rows = [{
    id: 'vessel-1',
    name: 'TEST VESSEL',
    imo_number: '1234567',
    mmsi_number: '123456789',
  }];
  const session = {
    user_id: 'owner-cloudflare-staging',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    session_id: 'd2507307-3f99-4af9-8c8b-6b92f89f7b57',
    revoked_at: null,
  };
  const db = {
    prepare: (sql: string) => new Statement(sql, tokenHash, session, rows, updates),
  };
  return {
    updates,
    env: { MIGRATION_DB: db } as unknown as Parameters<typeof migrationWorker.fetch>[1],
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('Staging Worker AISFriends compatibility route', () => {
  it('requires a same-origin D1 session before provider access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = {
      MIGRATION_DB: { prepare: () => { throw new Error('D1 must not be accessed without a session cookie'); } },
    } as unknown as Parameters<typeof migrationWorker.fetch>[1];
    const request = new Request(endpoint, {
      method: 'POST',
      headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: '{}',
    });

    const response = await migrationWorker.fetch(request, env);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'UNAUTHORIZED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests before database or provider access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = {
      MIGRATION_DB: { prepare: () => { throw new Error('D1 must not be accessed cross-origin'); } },
    } as unknown as Parameters<typeof migrationWorker.fetch>[1];
    const request = new Request(endpoint, {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
      body: '{}',
    });

    const response = await migrationWorker.fetch(request, env);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'ORIGIN_FORBIDDEN' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('updates positions using the D1 session organization and AISFriends provider', async () => {
    const { env, updates } = await environment();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      latitude: 31.1234,
      longitude: 50.5678,
      speed: 12,
      course: 90,
      timestamp: '2026-11-23T18:00:00Z',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request(endpoint, {
      method: 'POST',
      headers: {
        origin,
        'sec-fetch-site': 'same-origin',
        cookie: 'customs_os_stage_session=' + token,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const response = await migrationWorker.fetch(request, env);
    const payload = await response.json() as { updated: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(payload.updated).toHaveLength(1);
    expect(payload.updated[0].id).toBe('vessel-1');
    expect(updates[0].sql).toContain('organization_id = ?');
    expect(updates[0].values.at(-1)).toBe('ad95fdf1-e0e2-439b-92b0-c20ab07cacdd');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
