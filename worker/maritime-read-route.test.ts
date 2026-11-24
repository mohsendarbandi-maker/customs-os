import { afterEach, describe, expect, it, vi } from 'vitest';
import migrationWorker from './migration-staging';

const origin = 'https://customs-os-migration-staging.mohsen-darbandi.workers.dev';
const token = 'maritime-read-session-token';

const hashToken = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

class MockStatement {
  private values: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly tokenHash: string,
    private readonly sessionRow: Record<string, unknown>,
    private readonly vessels: Array<Record<string, unknown>>,
    private readonly shipments: Array<Record<string, unknown>>,
    private readonly calls: Array<{ sql: string; values: unknown[] }>,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes('FROM customs_admin_sessions') && this.values[0] === this.tokenHash) {
      return this.sessionRow as T;
    }
    return null;
  }

  async all<T>() {
    this.calls.push({ sql: this.sql, values: this.values });
    if (this.sql.includes('FROM vessels')) return { results: this.vessels as T[] };
    if (this.sql.includes('FROM shipments')) return { results: this.shipments as T[] };
    return { results: [] as T[] };
  }

  async run() {
    return { meta: { changes: 0 } };
  }
}

const makeEnv = async () => {
  const tokenHash = await hashToken(token);
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const vessels = [{
    id: 'vessel-1',
    organization_id: 'ad95fdf1-e0e2-439b-92b0-c20ab07cacdd',
    name: 'TEST VESSEL',
    imo_number: '1234567',
    mmsi_number: '123456789',
    flag_code: 'IR',
    last_latitude: '31.1234',
    last_longitude: '50.5678',
    last_position_at: '2026-11-23T18:00:00Z',
    last_position_source: 'openwaters-ais',
    last_speed_knots: '12',
    last_course_deg: '90',
  }];
  const shipments = [{
    id: 'shipment-1',
    vessel_id: 'vessel-1',
    shipping_line: 'Test Line',
    bill_of_lading_no: 'BL-1',
    current_status: 'in_transit',
    origin_port: 'Bandar Anzali',
    destination_port: 'Astrakhan',
    created_at: '2026-11-23T18:00:00Z',
  }];
  const sessionRow = {
    user_id: 'owner-cloudflare-staging',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    session_id: 'd2507307-3f99-4af9-8c8b-6b92f89f7b57',
    revoked_at: null,
  };
  const db = {
    prepare: (sql: string) => new MockStatement(
      sql,
      tokenHash,
      sessionRow,
      vessels,
      shipments,
      calls,
    ),
  };
  return {
    calls,
    env: { MIGRATION_DB: db } as unknown as Parameters<typeof migrationWorker.fetch>[1],
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Staging Worker maritime read routes', () => {
  it('blocks unauthenticated vessel list requests before querying D1', async () => {
    const env = {
      MIGRATION_DB: { prepare: () => { throw new Error('D1 must not be accessed without a session'); } },
    } as unknown as Parameters<typeof migrationWorker.fetch>[1];
    const request = new Request(origin + '/api/maritime/vessels', {
      headers: { origin, 'sec-fetch-site': 'same-origin' },
    });

    const response = await migrationWorker.fetch(request, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'UNAUTHORIZED' });
  });

  it('blocks cross-origin reads before querying D1', async () => {
    const env = {
      MIGRATION_DB: { prepare: () => { throw new Error('D1 must not be accessed cross-origin'); } },
    } as unknown as Parameters<typeof migrationWorker.fetch>[1];
    const request = new Request(origin + '/api/maritime/shipments', {
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    });

    const response = await migrationWorker.fetch(request, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'ORIGIN_FORBIDDEN' });
  });

  it('returns organization-scoped vessel positions from D1 for a valid session', async () => {
    const { env, calls } = await makeEnv();
    const request = new Request(origin + '/api/maritime/vessels', {
      headers: {
        origin,
        'sec-fetch-site': 'same-origin',
        cookie: 'customs_os_stage_session=' + token,
      },
    });

    const response = await migrationWorker.fetch(request, env);
    const payload = await response.json() as { count: number; vessels: Array<{ id: string; mmsi_number: string }> };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(payload.count).toBe(1);
    expect(payload.vessels[0]).toMatchObject({ id: 'vessel-1', mmsi_number: '123456789' });
    expect(calls[0].sql).toContain('WHERE organization_id = ?');
    expect(calls[0].values).toEqual(['ad95fdf1-e0e2-439b-92b0-c20ab07cacdd']);
  });

  it('returns compact shipment port/status rows from D1 for a valid session', async () => {
    const { env, calls } = await makeEnv();
    const request = new Request(origin + '/api/maritime/shipments', {
      headers: {
        origin,
        'sec-fetch-site': 'same-origin',
        cookie: 'customs_os_stage_session=' + token,
      },
    });

    const response = await migrationWorker.fetch(request, env);
    const payload = await response.json() as { count: number; shipments: Array<{ id: string; current_status: string }> };

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.shipments[0]).toMatchObject({ id: 'shipment-1', current_status: 'in_transit' });
    expect(calls[0].sql).toContain('WHERE organization_id = ?');
    expect(calls[0].values).toEqual(['ad95fdf1-e0e2-439b-92b0-c20ab07cacdd']);
  });
});
