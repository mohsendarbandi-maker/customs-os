import { afterEach, describe, expect, it, vi } from 'vitest';
import migrationWorker from './migration-staging';
import type { VesselAisStatement } from './sync-vessel-ais-api';

const origin = 'https://customs-os-migration-staging.mohsen-darbandi.workers.dev';
const endpoint = origin + '/functions/v1/sync-vessel-ais-v2';

class MockStatement implements VesselAisStatement {
  private values: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly sessionHash: string,
    private readonly sessionRow: Record<string, unknown>,
    private readonly vessels: Array<Record<string, unknown>>,
    private readonly updates: Array<{ sql: string; values: unknown[] }>,
    private readonly queries: Array<{ sql: string; values: unknown[] }>,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes('FROM customs_admin_sessions') && this.values[0] === this.sessionHash) {
      return this.sessionRow as T;
    }
    return null;
  }

  async all<T>() {
    this.queries.push({ sql: this.sql, values: this.values });
    if (this.sql.includes('FROM vessels') && this.sql.includes('SELECT id, name')) {
      return { results: this.vessels as T[] };
    }
    return { results: [] as T[] };
  }

  async run() {
    this.updates.push({ sql: this.sql, values: this.values });
    return { meta: { changes: 1 } };
  }
}

const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const feature = (mmsi: string) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [50.5678, 31.1234] },
  properties: { mmsi, name: 'Test vessel', sog: 12, cog: 90, heading: 91, seen: '2026-11-23T18:00:00Z' },
});

const makeEnv = async (
  vessels: Array<Record<string, unknown>> = [],
) => {
  const token = 'ais-route-session-token';
  const sessionHash = await hashToken(token);
  const updates: Array<{ sql: string; values: unknown[] }> = [];
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const sessionRow = {
    user_id: 'owner-cloudflare-staging',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    session_id: 'd2507307-3f99-4af9-8c8b-6b92f89f7b57',
    revoked_at: null,
  };
  const db = {
    prepare: (sql: string) => new MockStatement(sql, sessionHash, sessionRow, vessels, updates, queries),
  };
  return {
    token,
    updates,
    queries,
    env: { MIGRATION_DB: db } as unknown as Parameters<typeof migrationWorker.fetch>[1],
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Staging Worker Open Waters AIS route', () => {
  it('rejects requests without a D1 session before contacting Open Waters', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request(endpoint, {
      method: 'POST',
      headers: {
        origin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mode: 'live-caspian' }),
    });
    const env = {
      MIGRATION_DB: { prepare: () => { throw new Error('D1 must not be accessed without a session cookie'); } },
    } as unknown as Parameters<typeof migrationWorker.fetch>[1];

    const response = await migrationWorker.fetch(request, env);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'UNAUTHORIZED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests before looking up the D1 session', async () => {
    const request = new Request(endpoint, {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mode: 'live-caspian' }),
    });
    const env = {
      MIGRATION_DB: { prepare: () => { throw new Error('D1 must not be accessed cross-origin'); } },
    } as unknown as Parameters<typeof migrationWorker.fetch>[1];

    const response = await migrationWorker.fetch(request, env);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'ORIGIN_FORBIDDEN' });
  });

  it('serves live Caspian AIS after validating the same-origin D1 session', async () => {
    const { token, env } = await makeEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: [feature('123456789')] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: [feature('223456789')] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request(endpoint, {
      method: 'POST',
      headers: {
        origin,
        'sec-fetch-site': 'same-origin',
        cookie: 'customs_os_stage_session=' + token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mode: 'live-caspian' }),
    });

    const response = await migrationWorker.fetch(request, env);
    const payload = await response.json() as { count: number; vessels: Array<{ mmsi: string }> };

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(payload.count).toBe(2);
    expect(payload.vessels.map((vessel) => vessel.mmsi).sort()).toEqual(['123456789', '223456789']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('updates tracked MMSI positions through D1 and keeps the same invocation URL contract', async () => {
    const { token, env, updates, queries } = await makeEnv([
      { id: 'vessel-1', name: 'Vessel One', imo_number: '1234567', mmsi_number: '123456789' },
    ]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      features: [feature('123456789')],
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
      body: JSON.stringify({}),
    });

    const response = await migrationWorker.fetch(request, env);
    const payload = await response.json() as {
      checked: number;
      updated: Array<{ id: string; mmsi: string }>;
      failed: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.checked).toBe(1);
    expect(payload.updated).toHaveLength(1);
    expect(payload.updated[0]).toMatchObject({ id: 'vessel-1', mmsi: '123456789' });
    expect(payload.failed).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain('UPDATE vessels SET');
    expect(updates[0].sql).toContain('WHERE id = ? AND organization_id = ?');
    expect(updates[0].values.at(-2)).toBe('vessel-1');
    expect(updates[0].values.at(-1)).toBe('ad95fdf1-e0e2-439b-92b0-c20ab07cacdd');
    expect(queries[0].sql).toContain('WHERE organization_id = ? AND mmsi_number IS NOT NULL');
    expect(queries[0].values).toEqual(['ad95fdf1-e0e2-439b-92b0-c20ab07cacdd']);
  });
});
