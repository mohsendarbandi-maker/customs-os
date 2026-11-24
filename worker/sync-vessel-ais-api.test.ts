import { describe, expect, it, vi } from 'vitest';
import {
  handleSyncVesselAisV2,
  type VesselAisDatabase,
  type VesselAisStatement,
} from './sync-vessel-ais-api';

const feature = (
  mmsi: string,
  lon = 50.5678,
  lat = 31.1234,
  extra: Record<string, unknown> = {},
) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {
    mmsi,
    name: 'TEST VESSEL ' + mmsi,
    sog: 12,
    cog: 90,
    heading: 91,
    seen: '2026-11-23T18:00:00Z',
    type: 'cargo',
    ...extra,
  },
});

const requestFor = (body: unknown) => new Request(
  'https://customs-os-migration-staging.mohsen-darbandi.workers.dev/functions/v1/sync-vessel-ais-v2',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  },
);

class MockStatement implements VesselAisStatement {
  private values: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly rows: Array<Record<string, unknown>>,
    private readonly updates: Array<{ sql: string; values: unknown[] }>,
    private readonly queries: Array<{ sql: string; values: unknown[] }>,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async all<T>() {
    this.queries.push({ sql: this.sql, values: this.values });
    if (this.sql.includes('FROM vessels') && this.sql.includes('SELECT id, name')) {
      return { results: this.rows as T[] };
    }
    return { results: [] as T[] };
  }

  async run() {
    this.updates.push({ sql: this.sql, values: this.values });
    return { meta: { changes: 1 } };
  }
}

class MockDatabase implements VesselAisDatabase {
  readonly updates: Array<{ sql: string; values: unknown[] }> = [];
  readonly queries: Array<{ sql: string; values: unknown[] }> = [];

  constructor(readonly rows: Array<Record<string, unknown>>) {}

  prepare(sql: string) {
    return new MockStatement(sql, this.rows, this.updates, this.queries);
  }
}

describe('Cloudflare Open Waters AIS sync', () => {
  it('reports provider authentication without exposing its token', async () => {
    const request = requestFor({ mode: 'health' });
    const response = await handleSyncVesselAisV2(request, new MockDatabase([]), 'private-provider-token');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      provider: 'Open Waters AIS',
      authenticated_provider: true,
    });
    expect(JSON.stringify(payload)).not.toContain('private-provider-token');
  });

  it('validates MMSI before making an external request', async () => {
    const fetchMock = vi.fn();
    const response = await handleSyncVesselAisV2(
      requestFor({ mode: 'lookup-mmsi', mmsi: '12345' }),
      new MockDatabase([]),
      undefined,
      fetchMock,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_MMSI' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns one normalized vessel for lookup-mmsi', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      features: [feature('123456789')],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const response = await handleSyncVesselAisV2(
      requestFor({ mode: 'lookup-mmsi', mmsi: '123456789' }),
      new MockDatabase([]),
      undefined,
      fetchMock,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      mode: 'lookup-mmsi',
      found: true,
      vessel: {
        mmsi: '123456789',
        lat: 31.1234,
        lon: 50.5678,
        sog: 12,
        cog: 90,
        heading: 91,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates live Caspian vessels by MMSI across both bounding boxes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        features: [feature('123456789'), feature('223456789', 51.2, 32.2)],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        features: [feature('123456789', 50.6, 31.2), feature('323456789', 52.2, 33.2)],
      }), { status: 200 }));

    const response = await handleSyncVesselAisV2(
      requestFor({ mode: 'live-caspian' }),
      new MockDatabase([]),
      undefined,
      fetchMock,
    );
    const payload = await response.json() as { count: number; vessels: Array<{ mmsi: string }> };

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(payload.count).toBe(3);
    expect(payload.vessels.map((vessel) => vessel.mmsi).sort()).toEqual([
      '123456789',
      '223456789',
      '323456789',
    ]);
  });

  it('refuses tracked writes when no organization scope is supplied', async () => {
    const fetchMock = vi.fn();
    const db = new MockDatabase([
      { id: 'vessel-1', name: 'Vessel One', imo_number: '1234567', mmsi_number: '123456789' },
    ]);
    const response = await handleSyncVesselAisV2(requestFor({}), db, undefined, fetchMock);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'ORGANIZATION_SCOPE_REQUIRED' });
    expect(db.queries).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('updates tracked vessel positions using the verified D1 vessels schema', async () => {
    const db = new MockDatabase([
      { id: 'vessel-1', name: 'Vessel One', imo_number: '1234567', mmsi_number: '123456789' },
      { id: 'vessel-2', name: 'Vessel Two', imo_number: null, mmsi_number: '223456789' },
    ]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      features: [
        feature('123456789'),
        feature('223456789', 52.1, 33.1, { sog: null, cog: null }),
      ],
    }), { status: 200 }));

    const response = await handleSyncVesselAisV2(requestFor({}), db, undefined, fetchMock, 'org-1');
    const payload = await response.json() as {
      checked: number;
      updated: Array<{ id: string; mmsi: string }>;
      failed: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      provider: 'Open Waters AIS',
      checked: 2,
    });
    expect(payload.updated).toHaveLength(2);
    expect(payload.failed).toHaveLength(0);
    expect(db.updates).toHaveLength(2);
    expect(db.updates[0].sql).toContain('UPDATE vessels SET');
    expect(db.updates[0].sql).toContain('last_latitude = ?');
    expect(db.updates[0].sql).toContain('last_position_source = ?');
    expect(db.queries[0].sql).toContain('WHERE organization_id = ?');
    expect(db.queries[0].values).toEqual(['org-1']);
    expect(db.updates[0].sql).toContain('WHERE id = ? AND organization_id = ?');
    expect(db.updates[1].sql).not.toContain('last_speed_knots = ?');
    expect(db.updates[1].sql).not.toContain('last_course_deg = ?');
    expect(db.updates[0].values.at(-2)).toBe('vessel-1');
    expect(db.updates[0].values.at(-1)).toBe('org-1');
  });

  it('returns MMSI_REQUIRED without calling the AIS provider when no tracked vessels exist', async () => {
    const fetchMock = vi.fn();
    const response = await handleSyncVesselAisV2(requestFor({}), new MockDatabase([]), undefined, fetchMock, 'org-1');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ code: 'MMSI_REQUIRED', checked: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('isolates provider outages and returns a safe 502 error', async () => {
    const fetchMock = vi.fn(async () => new Response('provider secret details', { status: 503 }));
    const response = await handleSyncVesselAisV2(
      requestFor({ mode: 'lookup-mmsi', mmsi: '123456789' }),
      new MockDatabase([]),
      'private-provider-token',
      fetchMock,
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toMatchObject({ ok: false, code: 'AIS_PROVIDER_UNAVAILABLE' });
    expect(JSON.stringify(payload)).not.toContain('private-provider-token');
    expect(JSON.stringify(payload)).not.toContain('provider secret details');
  });

  it('rejects unsupported sync modes', async () => {
    const response = await handleSyncVesselAisV2(
      requestFor({ mode: 'arbitrary-mode' }),
      new MockDatabase([]),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'UNSUPPORTED_MODE' });
  });

  it('rejects unsupported HTTP methods', async () => {
    const request = new Request(
      'https://customs-os-migration-staging.mohsen-darbandi.workers.dev/functions/v1/sync-vessel-ais-v2',
      { method: 'GET' },
    );
    const response = await handleSyncVesselAisV2(request, new MockDatabase([]));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });
});
