import { describe, expect, it } from 'vitest';
import { handleCaseSelectorApi, type CaseSelectorD1Database, type CaseSelectorD1Statement } from './case-selector-api';

class FakeStatement implements CaseSelectorD1Statement {
  values: unknown[] = [];
  constructor(readonly sql: string, private readonly db: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T = Record<string, unknown>>() { return this.db.all<T>(this.sql, this.values); }
}
class FakeD1 implements CaseSelectorD1Database {
  queries: Array<{ sql: string; values: unknown[] }> = [];
  prepare(sql: string) { return new FakeStatement(sql, this); }
  async all<T>(sql: string, values: unknown[]) {
    this.queries.push({ sql, values });
    if (sql.includes('FROM clients WHERE organization_id=')) return {
      results: [{ id: 'client-a', name: 'شرکت الف', national_id: '123' }] as T[],
    };
    if (sql.includes('FROM vessels WHERE organization_id=')) return {
      results: [{ id: 'vessel-a', name: 'کشتی الف', imo_number: 'IMO-1', flag_code: 'PA', shipping_line_id: null }] as T[],
    };
    if (sql.includes('FROM shipments s LEFT JOIN cases c')) return {
      results: [{
        id: 'shipment-a', case_id: 'case-a', client_id: 'client-a', vessel_id: 'vessel-a',
        client_name: 'شرکت الف', vessel_name: 'کشتی الف', cargo_count: 20, cargo_count_unit: 'تن',
      }] as T[],
    };
    if (sql.includes('FROM customs_declarations WHERE organization_id=')) return {
      results: [{
        id: 'declaration-a', shipment_id: 'shipment-a', case_id: 'case-a',
        kottaj_number: '1405-1', workflow_stage: 3,
      }] as T[],
    };
    throw new Error('Unexpected SQL: ' + sql);
  }
}
const profile = { id: 'user-a', organization_id: 'org-a', role: 'owner', is_active: true };
const request = (method = 'GET') => new Request('https://staging.example/api/case-selector-data', { method });

describe('Cloudflare D1 case selector API', () => {
  it('returns clients, vessels, shipments and declarations using tenant-scoped queries', async () => {
    const db = new FakeD1();
    const response = await handleCaseSelectorApi(request(), db, profile);
    const body = await response.json() as {
      clients: Array<{ id: string }>;
      vessels: Array<{ id: string }>;
      shipments: Array<{ id: string; client_name: string }>;
      declarations: Array<{ id: string }>;
      dataScope: string;
      checklistStatus: string;
      checklistCompletionVerified: boolean;
    };
    expect(response.status).toBe(200);
    expect(body.clients[0].id).toBe('client-a');
    expect(body.vessels[0].id).toBe('vessel-a');
    expect(body.shipments[0]).toEqual(expect.objectContaining({ id: 'shipment-a', client_name: 'شرکت الف' }));
    expect(body.declarations[0].id).toBe('declaration-a');
    expect(body.dataScope).toBe('authenticated_organization_only');
    expect(body.checklistStatus).toBe('not_migrated');
    expect(body.checklistCompletionVerified).toBe(false);
    expect(db.queries).toHaveLength(4);
    expect(db.queries.every((query) => query.values[0] === 'org-a')).toBe(true);
    expect(db.queries[2].sql).toContain('s.organization_id=?');
  });

  it('rejects inactive and unsupported roles before querying D1', async () => {
    const db = new FakeD1();
    const response = await handleCaseSelectorApi(request(), db, { ...profile, role: 'client' });
    expect(response.status).toBe(403);
    expect(db.queries).toHaveLength(0);
  });

  it('rejects non-GET requests before querying D1', async () => {
    const db = new FakeD1();
    const response = await handleCaseSelectorApi(request('POST'), db, profile);
    expect(response.status).toBe(405);
    expect(db.queries).toHaveLength(0);
  });

  it('returns an explicit service error when a required D1 query fails', async () => {
    const db = { prepare: () => ({ bind: () => ({ all: async () => { throw new Error('D1 unavailable'); } }) }) } as unknown as CaseSelectorD1Database;
    const response = await handleCaseSelectorApi(request(), db, profile);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: 'CASE_SELECTOR_DATA_UNAVAILABLE' });
  });
});
