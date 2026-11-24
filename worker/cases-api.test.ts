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
  auditEvents: Array<Record<string, unknown>> = [];
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
    if (sql.includes('FROM customs_os_audit_events')) return { results: this.auditEvents as T[] };
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
    expect(db.queries[0].sql.replace(/\s/g, '')).toContain('c.organization_id=?');
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
    expect(db.queries[0].sql.replace(/\s/g, '')).toContain('c.organization_id=?');
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

  it('returns D1 audit events and derives only recorded case status changes', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    db.auditEvents = [{
      id: 'event-a',
      actor_user_id: 'user-a',
      action: 'update',
      entity_type: 'case',
      entity_id: 'case-a',
      before_json: JSON.stringify({ status: 'draft', case_number: '1405-1' }),
      after_json: JSON.stringify({ status: 'documents', notes: 'اسناد دریافت شد' }),
      created_at: '2026-11-23T10:00:00.000Z',
    }];
    const url = new URL('https://staging.example/api/cases/case-a/history');
    const response = await handleCasesApi(req('GET', url.pathname), db, url, owner);
    const body = await response.json() as {
      case: { id: string };
      history: Array<{ previous_status: string | null; new_status: string; notes: string | null }>;
      audit: Array<{ action: string; table_name: string; user_id: string; record_id: string }>;
      historySource: string;
      legacyHistoryBackfill: string;
    };
    expect(response.status).toBe(200);
    expect(body.case.id).toBe('case-a');
    expect(body.history).toEqual([expect.objectContaining({
      previous_status: 'draft',
      new_status: 'documents',
      notes: 'اسناد دریافت شد',
    })]);
    expect(body.audit).toEqual([expect.objectContaining({
      action: 'UPDATE',
      table_name: 'case',
      user_id: 'user-a',
      record_id: 'case-a',
    })]);
    expect(body.historySource).toBe('customs_os_audit_events');
    expect(body.legacyHistoryBackfill).toBe('not_imported');
    const auditQuery = db.queries.find(query => query.sql.includes('FROM customs_os_audit_events'));
    expect(auditQuery?.sql).toContain('organization_id=?');
    expect(auditQuery?.values).toEqual(['org-a', 'case', 'case-a']);
  });

  it('does not query audit history for a case outside the current organization', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/cases/foreign-case/history');
    const response = await handleCasesApi(req('GET', url.pathname), db, url, owner);
    expect(response.status).toBe(404);
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].values).toEqual(['foreign-case', 'org-a']);
    expect(db.queries.some(query => query.sql.includes('customs_os_audit_events'))).toBe(false);
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
