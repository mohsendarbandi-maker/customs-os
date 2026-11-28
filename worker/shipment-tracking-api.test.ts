import { describe, expect, it } from 'vitest';
import {
  handleShipmentTrackingApi,
  type ShipmentTrackingDatabase,
  type ShipmentTrackingStatement,
  type ShipmentTrackingProfile,
} from './shipment-tracking-api';

type Row = Record<string, unknown>;
class Statement implements ShipmentTrackingStatement {
  values: unknown[] = [];
  constructor(readonly sql: string, private readonly db: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Row>() { return this.db.first<T>(this.sql, this.values); }
  async all<T = Row>() { return this.db.all<T>(this.sql, this.values); }
  async run() { return { meta: { changes: 1 } }; }
}
const org = 'org-a';
const profile: ShipmentTrackingProfile = { id: 'user-a', organization_id: org, role: 'owner', is_active: true };
const shipment = { id: 'shipment-a', organization_id: org, ship_passed: 0, ship_passed_at: null, ship_passed_by: null };
const makeRequest = (method: string, path: string, body?: unknown, origin = 'https://staging.example') =>
  new Request('https://staging.example' + path, {
    method,
    headers: { ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const makeUrl = (path: string) => new URL('https://staging.example' + path);

class FakeD1 implements ShipmentTrackingDatabase {
  shipment: Row | null = shipment;
  events: Row[] = [];
  batches: ShipmentTrackingStatement[][] = [];
  prepare(sql: string) { return new Statement(sql, this); }
  async batch(statements: ShipmentTrackingStatement[]) {
    this.batches.push(statements);
    return [];
  }
  async first<T>(sql: string, values: unknown[]): Promise<T | null> {
    if (sql.includes('FROM shipments')) {
      if (values[0] !== shipment.id || values[1] !== org || !this.shipment) return null;
      return this.shipment as T;
    }
    if (sql.includes('FROM shipment_tracking_events')) {
      const row = this.events.find(item => item.id === values[0] && item.organization_id === values[1]);
      return (row || null) as T | null;
    }
    return null;
  }
  async all<T>(sql: string, values: unknown[]) {
    if (sql.includes('FROM shipment_tracking_events')) {
      return { results: this.events.filter(item => item.shipment_id === values[0] && item.organization_id === values[1]) as T[] };
    }
    return { results: [] as T[] };
  }
}

describe('Cloudflare D1 shipment tracking API', () => {
  it('returns only events belonging to the authenticated organization and shipment', async () => {
    const db = new FakeD1();
    db.events = [
      { id: 'event-a', organization_id: org, shipment_id: 'shipment-a', event_code: 'departed' },
      { id: 'event-b', organization_id: 'org-b', shipment_id: 'shipment-a', event_code: 'delayed' },
    ];
    const path = '/api/shipments/shipment-a/tracking-events';
    const response = await handleShipmentTrackingApi(makeRequest('GET', path), db, makeUrl(path), profile);
    const body = await response.json() as { events: Row[] };
    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBe('event-a');
  });

  it('rejects client-role access before querying shipment records', async () => {
    const db = new FakeD1();
    const path = '/api/shipments/shipment-a/tracking-events';
    const response = await handleShipmentTrackingApi(
      makeRequest('GET', path), db, makeUrl(path),
      { ...profile, role: 'client' },
    );
    expect(response.status).toBe(403);
    expect(db.batches).toHaveLength(0);
  });

  it('rejects shipment identifiers from another organization', async () => {
    const db = new FakeD1();
    const path = '/api/shipments/foreign/tracking-events';
    const response = await handleShipmentTrackingApi(makeRequest('GET', path), db, makeUrl(path), profile);
    expect(response.status).toBe(404);
    expect(db.batches).toHaveLength(0);
  });

  it('rejects invalid event codes before writing', async () => {
    const db = new FakeD1();
    const path = '/api/shipments/shipment-a/tracking-events';
    const response = await handleShipmentTrackingApi(makeRequest('POST', path, {
      eventCode: 'not-a-real-event', timeType: 'actual',
    }), db, makeUrl(path), profile);
    expect(response.status).toBe(400);
    expect(db.batches).toHaveLength(0);
  });

  it('requires same-origin mutations', async () => {
    const db = new FakeD1();
    const path = '/api/shipments/shipment-a/ship-pass';
    const response = await handleShipmentTrackingApi(makeRequest('POST', path, { passed: true }, 'https://evil.example'), db, makeUrl(path), profile);
    expect(response.status).toBe(403);
    expect(db.batches).toHaveLength(0);
  });

  it('rejects ship-pass writes from warehouse role', async () => {
    const db = new FakeD1();
    const path = '/api/shipments/shipment-a/ship-pass';
    const response = await handleShipmentTrackingApi(
      makeRequest('POST', path, { passed: true }), db, makeUrl(path),
      { ...profile, role: 'warehouse' },
    );
    expect(response.status).toBe(403);
    expect(db.batches).toHaveLength(0);
  });
});
