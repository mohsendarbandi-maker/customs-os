import { describe, expect, it } from 'vitest';
import {
  handleMaritimeReadApi,
  type MaritimeReadDatabase,
  type MaritimeReadStatement,
} from './maritime-read-api';

const organizationId = 'ad95fdf1-e0e2-439b-92b0-c20ab07cacdd';
const profile = { organization_id: organizationId };

class MockStatement implements MaritimeReadStatement {
  private values: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly rows: Array<Record<string, unknown>>,
    private readonly calls: Array<{ sql: string; values: unknown[] }>,
    private readonly shouldFail = false,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async all<T>() {
    this.calls.push({ sql: this.sql, values: this.values });
    if (this.shouldFail) throw new Error('database unavailable');
    return { results: this.rows as T[] };
  }
}

const dbFor = (rows: Array<Record<string, unknown>>, shouldFail = false) => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db: MaritimeReadDatabase = {
    prepare: (sql) => new MockStatement(sql, rows, calls, shouldFail),
  };
  return { db, calls };
};

describe('D1 maritime read API', () => {
  it('returns vessel tracking data from the existing organization-scoped D1 table', async () => {
    const { db, calls } = dbFor([{
      id: 'vessel-1',
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
    }]);
    const response = await handleMaritimeReadApi(
      new Request('https://staging.example/api/maritime/vessels'),
      db,
      new URL('https://staging.example/api/maritime/vessels'),
      profile,
    );
    const payload = await response.json() as { count: number; vessels: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.vessels[0].id).toBe('vessel-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('FROM vessels WHERE organization_id = ?');
    expect(calls[0].values).toEqual([organizationId]);
  });

  it('returns compact shipment port/status records from D1', async () => {
    const { db, calls } = dbFor([{
      id: 'shipment-1',
      vessel_id: 'vessel-1',
      shipping_line: 'Test Line',
      bill_of_lading_no: 'BL-1',
      current_status: 'in_transit',
      origin_port: 'Bandar Anzali',
      destination_port: 'Astrakhan',
      created_at: '2026-11-23T18:00:00Z',
    }]);
    const response = await handleMaritimeReadApi(
      new Request('https://staging.example/api/maritime/shipments'),
      db,
      new URL('https://staging.example/api/maritime/shipments'),
      profile,
    );
    const payload = await response.json() as { count: number; shipments: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.shipments[0].id).toBe('shipment-1');
    expect(calls[0].sql).toContain('FROM shipments WHERE organization_id = ?');
    expect(calls[0].values).toEqual([organizationId]);
  });

  it('does not query any organization when the profile has no organization id', async () => {
    const { db, calls } = dbFor([]);
    const response = await handleMaritimeReadApi(
      new Request('https://staging.example/api/maritime/vessels'),
      db,
      new URL('https://staging.example/api/maritime/vessels'),
      { organization_id: '' },
    );

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('returns service unavailable instead of a fabricated empty dataset when D1 fails', async () => {
    const { db } = dbFor([], true);
    const response = await handleMaritimeReadApi(
      new Request('https://staging.example/api/maritime/vessels'),
      db,
      new URL('https://staging.example/api/maritime/vessels'),
      profile,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'MARITIME_VESSELS_UNAVAILABLE' });
  });

  it('rejects non-GET requests', async () => {
    const { db, calls } = dbFor([]);
    const response = await handleMaritimeReadApi(
      new Request('https://staging.example/api/maritime/shipments', { method: 'POST' }),
      db,
      new URL('https://staging.example/api/maritime/shipments'),
      profile,
    );

    expect(response.status).toBe(405);
    expect(calls).toHaveLength(0);
  });
});
