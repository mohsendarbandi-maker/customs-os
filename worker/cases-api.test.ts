import { describe, expect, it } from 'vitest';
import { handleCasesApi, type CasesD1Database, type CasesD1Statement, type CaseRecord } from './cases-api';

class FakeStatement implements CasesD1Statement {
  values: unknown[] = [];
  constructor(readonly sql: string, private readonly db: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return this.db.first<T>(this.sql, this.values); }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> { return this.db.all<T>(this.sql, this.values); }
}
class FakeD1 implements CasesD1Database {
  list: CaseRecord[] = [];
  detail: CaseRecord | null = null;
  related = { shipments: [] as unknown[], declarations: [] as unknown[], documents: [] as unknown[] };
  queries: Array<{ sql: string; values: unknown[] }> = [];
  prepare(sql: string) { return new FakeStatement(sql, this); }
  first<T>(sql: string, values: unknown[]): T | null {
    this.queries.push({ sql, values });
    if (sql.includes('COUNT(*) AS total FROM cases c')) return { total: this.list.length } as T;
    if (sql.includes('FROM cases c LEFT JOIN clients cl')) return this.detail as T | null;
    throw new Error('Unexpected query: ' + sql);
  }
  all<T>(sql: string, values: unknown[]): { results: T[] } {
    this.queries.push({ sql, values });
    if (sql.includes('FROM cases c LEFT JOIN clients cl')) {
      const limit = Number(values[values.length - 2]);
      const offset = Number(values[values.length - 1]);
      return { results: this.list.slice(offset, offset + limit) as T[] };
    }
    if (sql.includes('FROM shipments s LEFT JOIN vessels v')) return { results: this.related.shipments as T[] };
    if (sql.includes('FROM customs_declarations WHERE case_id')) return { results: this.related.declarations as T[] };
    if (sql.includes('FROM customs_documents WHERE case_id')) return { results: this.related.documents as T[] };
    throw new Error('Unexpected query: ' + sql);
  }
}
const owner = { id: 'user-a', organization_id: 'org-a', role: 'owner', is_active: true };
const req = (method: string, path: string) => new Request('https://staging.example' + path, { method });
const caseRow: CaseRecord = {
  id: 'case-a', case_number: '۱۴۰۵-۱', status: 'documents', client_id: 'client-a',
  client_name: 'بازرگانی الف', customs_office_id: null, registration_order_no: 'RO-1', proforma_no: null,
  cargo_description: 'خوراک دام', cargo_count: 20, cargo_count_unit: 'تن', net_weight_kg: 20000,
  gross_weight_kg: 20200, display_name: 'محموله الف', created_at: '2026-11-01', updated_at: null,
  shipment_count: 1, latest_shipment_id: 'shipment-a', shipment_display_name: 'محموله الف',
  bill_of_lading_no: 'BL-1', vessel_name: 'Vessel A', kottaj_number: null,
};

describe('Cloudflare D1 cases read API', () => {
  it('lists organization-scoped cases with search and pagination', async () => {
    const db = new FakeD1();
    db.list = [caseRow];
    const url = new URL('https://staging.example/api/cases?limit=1&offset=0&search=۱۴۰۵');
    const response = await handleCasesApi(req('GET', url.pathname + url.search), db, url, owner);
    const body = await response.json() as { items: CaseRecord[]; total: number; dataScope: string };
    expect(response.status).toBe(200);
    expect(body.items[0].id).toBe('case-a');
    expect(body.total).toBe(1);
    expect(body.dataScope).toBe('authenticated_organization_only');
    expect(db.queries[0].sql).toContain('c.organization_id = ?');
    expect(db.queries[0].values).toContain('org-a');
  });

  it('binds status parameters instead of interpolating user input', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/cases?status=ready%27%20OR%201%3D1');
    const response = await handleCasesApi(req('GET', url.pathname + url.search), db, url, owner);
    expect(response.status).toBe(200);
    expect(db.queries[0].sql).toContain('c.status = ?');
    expect(db.queries[0].values).toContain("ready' OR 1=1");
  });

  it('does not reveal another organization case by id', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/cases/foreign-case');
    const response = await handleCasesApi(req('GET', url.pathname), db, url, owner);
    expect(response.status).toBe(404);
    expect(db.queries[0].sql).toContain('c.organization_id = ?');
    expect(db.queries[0].values).toEqual(['foreign-case', 'org-a']);
  });

  it('returns actual linked shipment, declaration and document rows', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    db.related = {
      shipments: [{ id: 'shipment-a' }],
      declarations: [{ id: 'declaration-a' }],
      documents: [{ id: 'document-a' }],
    };
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(req('GET', url.pathname), db, url, owner);
    const body = await response.json() as { shipments: unknown[]; declarations: unknown[]; documents: unknown[]; readOnly: boolean };
    expect(response.status).toBe(200);
    expect(body.shipments).toHaveLength(1);
    expect(body.declarations).toHaveLength(1);
    expect(body.documents).toHaveLength(1);
    expect(body.readOnly).toBe(true);
  });

  it('rejects client role because client-specific record scoping is not migrated', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/cases');
    const response = await handleCasesApi(req('GET', url.pathname), db, url, { ...owner, role: 'client' });
    expect(response.status).toBe(403);
  });

  it('rejects write methods without executing SQL', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(req('PATCH', url.pathname), db, url, owner);
    expect(response.status).toBe(405);
    expect(db.queries).toHaveLength(0);
  });
});
