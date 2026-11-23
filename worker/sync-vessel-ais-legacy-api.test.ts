import { describe, expect, it, vi } from 'vitest';
import {
  handleLegacySyncVesselAis,
  type LegacyAisDatabase,
  type LegacyAisStatement,
} from './sync-vessel-ais-legacy-api';

class MockStatement implements LegacyAisStatement {
  private values: unknown[] = [];
  constructor(
    private readonly sql: string,
    private readonly rows: Array<Record<string, unknown>>,
    readonly updates: Array<{ sql: string; values: unknown[] }>,
    readonly queries: Array<{ sql: string; values: unknown[] }>,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async all<T>() {
    this.queries.push({ sql: this.sql, values: this.values });
    return { results: this.rows as T[] };
  }
  async run() {
    this.updates.push({ sql: this.sql, values: this.values });
    return { meta: { changes: 1 } };
  }
}
class MockDatabase implements LegacyAisDatabase {
  readonly updates: Array<{ sql: string; values: unknown[] }> = [];
  readonly queries: Array<{ sql: string; values: unknown[] }> = [];
  constructor(readonly rows: Array<Record<string, unknown>>) {}
  prepare(sql: string) {
    return new MockStatement(sql, this.rows, this.updates, this.queries);
  }
}
const request = (method = 'POST') => new Request(
  'https://staging.example/functions/v1/sync-vessel-ais',
  { method },
);

describe('Cloudflare AISFriends legacy sync', () => {
  it('rejects tracked writes without organization scope before D1 or provider access', async () => {
    const db = new MockDatabase([{ id: 'v1', name: 'Vessel', imo_number: '1234567' }]);
    const fetchMock = vi.fn();
    const response = await handleLegacySyncVesselAis(request(), db, undefined, fetchMock);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'ORGANIZATION_SCOPE_REQUIRED' });
    expect(db.queries).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('updates a vessel by IMO and confines both selection and update to its organization', async () => {
    const db = new MockDatabase([{
      id: 'vessel-1',
      name: 'TEST VESSEL',
      imo_number: '1234567',
      mmsi_number: '123456789',
    }]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{
      latitude: 31.1234,
      longitude: 50.5678,
      speed: 12,
      course: 90,
      timestamp: '2026-11-23T18:00:00Z',
    }]), { status: 200 }));
    const response = await handleLegacySyncVesselAis(request(), db, 'org-1', fetchMock);
    const payload = await response.json() as {
      checked: number;
      updated: Array<{ id: string; lat: number; lon: number }>;
      failed: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      provider: 'AISFriends',
      checked: 1,
      updated: [{ id: 'vessel-1', lat: 31.1234, lon: 50.5678 }],
      failed: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.queries[0].sql).toContain('WHERE organization_id = ?');
    expect(db.queries[0].values).toEqual(['org-1']);
    expect(db.updates[0].sql).toContain('WHERE id = ? AND organization_id = ?');
    expect(db.updates[0].values.slice(-2)).toEqual(['vessel-1', 'org-1']);
  });

  it('isolates one provider failure and continues processing the remaining vessels', async () => {
    const db = new MockDatabase([
      { id: 'vessel-1', name: 'Vessel One', imo_number: '1234567', mmsi_number: null },
      { id: 'vessel-2', name: 'Vessel Two', imo_number: null, mmsi_number: '123456789' },
    ]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('provider unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { latitude: 32.1, longitude: 51.2 },
      }), { status: 200 }));
    const response = await handleLegacySyncVesselAis(request(), db, 'org-1', fetchMock);
    const payload = await response.json() as {
      updated: Array<{ id: string }>;
      failed: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.failed.map((item) => item.id)).toEqual(['vessel-1']);
    expect(payload.updated.map((item) => item.id)).toEqual(['vessel-2']);
    expect(db.updates).toHaveLength(1);
  });

  it('returns an empty successful result when the organization has no MMSI or IMO vessels', async () => {
    const db = new MockDatabase([]);
    const fetchMock = vi.fn();
    const response = await handleLegacySyncVesselAis(request(), db, 'org-1', fetchMock);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'AISFriends',
      checked: 0,
      updated: [],
      failed: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods', async () => {
    const db = new MockDatabase([]);
    const response = await handleLegacySyncVesselAis(request('GET'), db, 'org-1');
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({ error: 'METHOD_NOT_ALLOWED' });
  });
});
