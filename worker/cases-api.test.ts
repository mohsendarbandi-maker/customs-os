import { describe, expect, it } from 'vitest';
import { handleCasesApi, type CasesD1Database, type CasesD1Statement, type CaseRecord } from './cases-api';

class FakeStatement implements CasesD1Statement {
  values: unknown[] = [];
  constructor(readonly sql: string, private readonly db: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return this.db.first<T>(this.sql, this.values); }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> { return this.db.all<T>(this.sql, this.values); }
  async run(): Promise<{ meta?: { changes?: number } }> { return this.db.run(this.sql, this.values); }
}
class FakeD1 implements CasesD1Database {
  list: CaseRecord[] = [];
  detail: CaseRecord | null = null;
  detailOrganizationId = 'org-a';
  related = { shipments: [] as unknown[], declarations: [] as unknown[], documents: [] as unknown[], permits: [] as unknown[] };
  permits: Array<Record<string, unknown>> = [];
  auditEvents: Array<Record<string, unknown>> = [];
  queries: Array<{ sql: string; values: unknown[] }> = [];
  lastChanges = 0;
  simulateCaseConflict = false;
  prepare(sql: string) { return new FakeStatement(sql, this); }
  async batch(statements: CasesD1Statement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
  first<T>(sql: string, values: unknown[]): T | null {
    this.queries.push({ sql, values });
    if (sql.includes('SELECT id FROM cases WHERE id=? AND organization_id=?')) {
      return this.detail?.id === values[0] && this.detailOrganizationId === values[1] ? { id: this.detail.id } as T : null;
    }
    if (sql.includes('FROM permits WHERE id=? AND case_id=? AND organization_id=?')) {
      return (this.permits.find(row => row.id === values[0] && row.case_id === values[1] && row.organization_id === values[2]) || null) as T | null;
    }
    if (sql.includes('COUNT(*) AS total FROM cases c')) return { total: this.list.length } as T;
    if (sql.includes('FROM cases c LEFT JOIN clients cl')) return this.detail as T | null;
    throw new Error('Unexpected query: ' + sql);
  }
  run(sql: string, values: unknown[]): { meta?: { changes?: number } } {
    this.queries.push({ sql, values });
    if (sql.startsWith('INSERT INTO permits (')) {
      this.permits.push({
        id: values[0], organization_id: values[1], case_id: values[2], permit_type: values[3],
        permit_number: values[4], issuing_authority: values[5], status: values[6],
        issued_at: values[7], expires_at: values[8], created_at: values[9], updated_at: values[10],
      });
      this.lastChanges = 1;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE permits SET')) {
      const permitId = values[values.length - 4];
      const caseId = values[values.length - 3];
      const orgId = values[values.length - 2];
      const updatedAt = values[values.length - 1];
      const row = this.permits.find(item => item.id === permitId && item.case_id === caseId && item.organization_id === orgId && item.updated_at === updatedAt);
      if (!row) { this.lastChanges = 0; return { meta: { changes: 0 } }; }
      const setPart = sql.split(' SET ')[1]?.split(' WHERE ')[0] || '';
      const columns = setPart.split(',').map(value => value.split('=')[0].trim());
      columns.forEach((column, index) => { row[column] = column === 'updated_at' ? '2026-11-25T09:00:01.000Z' : values[index]; });
      this.lastChanges = 1;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM permits')) {
      const [permitId, caseId, orgId, updatedAt] = values;
      const index = this.permits.findIndex(item => item.id === permitId && item.case_id === caseId && item.organization_id === orgId && item.updated_at === updatedAt);
      this.lastChanges = index >= 0 ? 1 : 0;
      if (index >= 0) this.permits.splice(index, 1);
      return { meta: { changes: this.lastChanges } };
    }
    if (sql.startsWith('INSERT INTO customs_os_audit_events')) {
      if (this.lastChanges !== 1) return { meta: { changes: 0 } };
      this.auditEvents.push({
        id: values[0], organization_id: values[1], actor_user_id: values[2],
        action: values[3], entity_type: values[4], entity_id: values[5],
        before_json: values[6], after_json: values[7], request_id: values[8],
        created_at: '2026-11-25T09:00:00.000Z',
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE cases SET')) {
      const [caseId, organizationId, previousUpdatedAt] = values.slice(-3);
      if (!this.detail || this.detail.id !== caseId) {
        this.lastChanges = 0;
        return { meta: { changes: 0 } };
      }
      const current = this.detail as unknown as Record<string, unknown>;
      if (this.simulateCaseConflict) {
        current.updated_at = '2026-11-25T09:01:00.000Z';
        this.simulateCaseConflict = false;
        this.lastChanges = 0;
        return { meta: { changes: 0 } };
      }
      // SQL assertions in the tests verify organization + timestamp compare-and-swap.
      // This fake models only the row match and the explicit competing-write case.
      void organizationId;
      void previousUpdatedAt;
      const setSql = sql.slice(sql.indexOf(' SET ') + 5, sql.lastIndexOf(' WHERE '));
      const columns = setSql.split(',').filter(part => part.includes('=?')).map(part => part.slice(0, part.indexOf('=')).trim());
      columns.forEach((column, index) => { current[column] = values[index]; });
      this.lastChanges = 1;
      return { meta: { changes: 1 } };
    }
    throw new Error('Unexpected run query: ' + sql);
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
    if (sql.includes('FROM permits WHERE case_id')) {
      const rows = [...this.related.permits, ...this.permits].filter(
        row => row.case_id === values[0] && row.organization_id === values[1],
      );
      return { results: rows as T[] };
    }
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
  gross_weight_kg: 20200, warehouse_receipt_no: 'WH-1405-01', warehouse_receipt_date: '2026-11-02',
  release_status: 'pending', valuation_status: 'calculated', unloading_date: '2026-11-03',
  vessel_type: 'foreign', customs_regime: 'definitive_import',
  display_name: 'محموله الف', created_at: '2026-11-01', updated_at: null,
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
    expect(body.items[0].warehouse_receipt_no).toBe('WH-1405-01');
    expect(body.items[0].release_status).toBe('pending');
    expect(body.items[0].valuation_status).toBe('calculated');
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

  it('updates only allowlisted case operational fields within the active organization', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow, organization_id: 'org-a' } as CaseRecord;
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({
        warehouse_receipt_no: 'WH-1405-2',
        release_status: 'released',
        valuation_status: 'approved',
        net_weight_kg: 21000,
        gross_weight_kg: 21200,
      }),
    }), db, url, owner);
    const body = await response.json() as { case: CaseRecord; ok: boolean };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.case.warehouse_receipt_no).toBe('WH-1405-2');
    expect(body.case.release_status).toBe('released');
    expect(body.case.valuation_status).toBe('approved');
    const update = db.queries.find(query => query.sql.startsWith('UPDATE cases SET'));
    expect(update?.sql).toContain('WHERE id=? AND organization_id=?');
    expect(update?.values.slice(-3)).toEqual(['case-a', 'org-a', null]);
    const audit = db.auditEvents.find(event => event.entity_type === 'case' && event.entity_id === 'case-a');
    expect(audit).toMatchObject({
      organization_id: 'org-a', actor_user_id: 'user-a', action: 'update', entity_type: 'case',
    });
    expect(JSON.parse(String(audit?.before_json))).toMatchObject({
      warehouse_receipt_no: 'WH-1405-01',
      release_status: 'pending',
    });
    expect(JSON.parse(String(audit?.after_json))).toMatchObject({
      warehouse_receipt_no: 'WH-1405-2',
      release_status: 'released',
    });
    expect(db.queries.findIndex(query => query.sql.startsWith('UPDATE cases SET')))
      .toBeLessThan(db.queries.findIndex(query => query.sql.startsWith('INSERT INTO customs_os_audit_events')));
  });

  it('returns a conflict and writes no audit event when the case changed after it was read', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow, organization_id: 'org-a' } as CaseRecord;
    db.simulateCaseConflict = true;
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ warehouse_receipt_no: 'WH-CONCURRENT' }),
    }), db, url, owner);
    expect(response.status).toBe(409);
    expect(db.auditEvents).toHaveLength(0);
    expect(db.queries.find(query => query.sql.startsWith('INSERT INTO customs_os_audit_events'))?.sql)
      .toContain('WHERE changes()>0');
  });

  it('does not update a case outside the active organization', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/cases/foreign-case');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ warehouse_receipt_no: 'WH-1' }),
    }), db, url, owner);
    expect(response.status).toBe(404);
    expect(db.queries.some(query => query.sql.startsWith('UPDATE cases SET'))).toBe(false);
  });

  it('rejects invalid release status and gross weight below net weight before SQL', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/cases/case-a');
    const invalidStatus = await handleCasesApi(new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ release_status: 'completed' }),
    }), db, url, owner);
    expect(invalidStatus.status).toBe(422);
    expect(db.queries).toHaveLength(0);

    db.detail = { ...caseRow };
    const invalidWeight = await handleCasesApi(new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ net_weight_kg: 20000, gross_weight_kg: 19000 }),
    }), db, url, owner);
    expect(invalidWeight.status).toBe(422);
    expect(db.queries.some(query => query.sql.startsWith('UPDATE cases SET'))).toBe(false);
  });

  it('rejects a single weight edit that would violate the persisted gross/net relationship', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow, net_weight_kg: 20000, gross_weight_kg: 20200 };
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ gross_weight_kg: 19000 }),
    }), db, url, owner);
    expect(response.status).toBe(422);
    expect(db.queries.some(query => query.sql.startsWith('UPDATE cases SET'))).toBe(false);
  });

  it('rejects case writes for roles without edit permissions', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow };
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ warehouse_receipt_no: 'WH-1' }),
    }), db, url, { ...owner, role: 'warehouse' });
    expect(response.status).toBe(403);
    expect(db.queries).toHaveLength(0);
  });

  it('returns actual linked shipment, declaration and document rows', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    db.related = {
      shipments: [{ id: 'shipment-a' }],
      declarations: [{ id: 'declaration-a' }],
      documents: [{ id: 'document-a' }],
      permits: [{ id: 'permit-a', organization_id: 'org-a', case_id: 'case-a', permit_type: 'health', status: 'approved' }],
    };
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(req('GET', url.pathname), db, url, owner);
    const body = await response.json() as {
      case: CaseRecord; shipments: unknown[]; declarations: unknown[]; documents: unknown[]; permits: unknown[]; readOnly: boolean;
    };
    expect(response.status).toBe(200);
    expect(body.shipments).toHaveLength(1);
    expect(body.declarations).toHaveLength(1);
    expect(body.documents).toHaveLength(1);
    expect(body.permits).toEqual([{
      id: 'permit-a', organization_id: 'org-a', case_id: 'case-a',
      permit_type: 'health', status: 'approved',
    }]);
    expect(body.readOnly).toBe(true);
    const shipmentQuery = db.queries.find(query => query.sql.includes('sc.registration_order_date_shamsi'));
    const permitQuery = db.queries.find(query => query.sql.includes('FROM permits WHERE case_id'));
    expect(permitQuery?.sql).toContain('organization_id=?');
    expect(permitQuery?.values).toEqual(['case-a', 'org-a']);
    expect(shipmentQuery?.sql).toContain('LEFT JOIN shipment_customs_data sc');
    expect(shipmentQuery?.sql).toContain('sc.registration_order_date_shamsi');
    expect(shipmentQuery?.sql).toContain('sc.insurance_irr');
    const declarationQuery = db.queries.find(query => query.sql.includes('FROM customs_declarations WHERE case_id'));
    expect(declarationQuery?.sql).toContain('payment_reference');
    expect(body.case.warehouse_receipt_date).toBe('2026-11-02');
    expect(body.case.unloading_date).toBe('2026-11-03');
    expect(body.case.vessel_type).toBe('foreign');
    expect(body.case.customs_regime).toBe('definitive_import');
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
    }, {
      id: 'event-permit-a',
      actor_user_id: 'user-a',
      action: 'update',
      entity_type: 'permit',
      entity_id: 'permit-a',
      before_json: JSON.stringify({ case_id: 'case-a', status: 'pending' }),
      after_json: JSON.stringify({ case_id: 'case-a', status: 'approved' }),
      created_at: '2026-11-23T10:01:00.000Z',
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
    expect(body.audit).toHaveLength(2);
    expect(body.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'UPDATE', table_name: 'case', user_id: 'user-a', record_id: 'case-a' }),
      expect.objectContaining({ action: 'UPDATE', table_name: 'permit', user_id: 'user-a', record_id: 'permit-a' }),
    ]));
    expect(body.historySource).toBe('customs_os_audit_events');
    expect(body.legacyHistoryBackfill).toBe('not_imported');
    const auditQuery = db.queries.find(query => query.sql.includes('FROM customs_os_audit_events'));
    expect(auditQuery?.sql).toContain('organization_id=?');
    expect(auditQuery?.values).toEqual(['org-a', 'case', 'case-a', 'permit', 'case-a']);
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

  it('rejects unsupported write methods without executing SQL', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(req('POST', url.pathname), db, url, owner);
    expect(response.status).toBe(405);
    expect(db.queries).toHaveLength(0);
  });

  it('lists case permits only inside the current organization', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    db.permits = [
      { id: 'permit-a', organization_id: 'org-a', case_id: 'case-a', permit_type: 'health', status: 'approved' },
      { id: 'permit-b', organization_id: 'org-b', case_id: 'case-a', permit_type: 'other', status: 'pending' },
    ];
    const url = new URL('https://staging.example/api/cases/case-a/permits');
    const response = await handleCasesApi(req('GET', url.pathname), db, url, owner);
    const body = await response.json() as { permits: Array<{ id: string }> };
    expect(response.status).toBe(200);
    expect(body.permits.map(row => row.id)).toEqual(['permit-a']);
    expect(db.queries.some(query => query.sql.includes('FROM permits WHERE case_id=? AND organization_id=?') &&
      query.values.join('|') === 'case-a|org-a')).toBe(true);
  });

  it('creates a permit atomically with an audit record for a case in the current organization', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    const url = new URL('https://staging.example/api/cases/case-a/permits');
    const response = await handleCasesApi(new Request(url, {
      method: 'POST',
      headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        permit_type: 'health', permit_number: 'H-123',
        issuing_authority: 'Health Authority', status: 'approved',
      }),
    }), db, url, owner);
    const body = await response.json() as { permit: { permit_type: string; status: string } };
    expect(response.status).toBe(201);
    expect(body.permit.permit_type).toBe('health');
    expect(body.permit.status).toBe('approved');
    expect(db.permits).toHaveLength(1);
    expect(db.auditEvents).toHaveLength(1);
    expect(db.auditEvents[0].action).toBe('create');
    expect(db.auditEvents[0].entity_type).toBe('permit');
  });

  it('rejects permit creation for a case outside the current organization', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow, id: 'foreign-case' };
    db.detailOrganizationId = 'org-b';
    const url = new URL('https://staging.example/api/cases/foreign-case/permits');
    const response = await handleCasesApi(new Request(url, {
      method: 'POST',
      headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ permit_type: 'health', issuing_authority: 'Authority' }),
    }), db, url, owner);
    expect(response.status).toBe(404);
    expect(db.permits).toHaveLength(0);
  });

  it('updates only allowlisted permit fields with an immutable audit record', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    db.permits = [{
      id: 'permit-a', organization_id: 'org-a', case_id: 'case-a', permit_type: 'health',
      permit_number: 'H-1', issuing_authority: 'Authority', status: 'pending',
      issued_at: null, expires_at: null, created_at: '2026-11-25T08:00:00.000Z',
      updated_at: '2026-11-25T08:00:00.000Z',
    }];
    const url = new URL('https://staging.example/api/cases/case-a/permits/permit-a');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved', permit_number: 'H-2' }),
    }), db, url, owner);
    expect(response.status).toBe(200);
    expect(db.permits[0].status).toBe('approved');
    expect(db.permits[0].permit_number).toBe('H-2');
    expect(db.auditEvents.at(-1)?.action).toBe('update');
    const update = db.queries.find(query => query.sql.startsWith('UPDATE permits SET'));
    expect(update?.sql).toContain('WHERE id=? AND case_id=? AND organization_id=? AND updated_at=?');
  });

  it('rejects permit expiration earlier than its issue date', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    const url = new URL('https://staging.example/api/cases/case-a/permits');
    const response = await handleCasesApi(new Request(url, {
      method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        permit_type: 'health', issuing_authority: 'Authority',
        issued_at: '2026-11-10T00:00:00Z', expires_at: '2026-11-09T00:00:00Z',
      }),
    }), db, url, owner);
    expect(response.status).toBe(422);
    expect(db.permits).toHaveLength(0);
  });

  it('deletes a permit within the case tenant and preserves a delete audit record', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    db.permits = [{
      id: 'permit-a', organization_id: 'org-a', case_id: 'case-a', permit_type: 'health',
      permit_number: 'H-1', issuing_authority: 'Authority', status: 'pending',
      issued_at: null, expires_at: null, created_at: '2026-11-25T08:00:00.000Z',
      updated_at: '2026-11-25T08:00:00.000Z',
    }];
    const url = new URL('https://staging.example/api/cases/case-a/permits/permit-a');
    const response = await handleCasesApi(new Request(url, {
      method: 'DELETE', headers: { origin: url.origin },
    }), db, url, owner);
    expect(response.status).toBe(200);
    expect(db.permits).toHaveLength(0);
    expect(db.auditEvents.at(-1)?.action).toBe('delete');
    expect(db.auditEvents.at(-1)?.before_json).toContain('permit-a');
    expect(db.auditEvents.at(-1)?.after_json).toBeNull();
  });

  it('rejects permit writes by warehouse and accountant roles', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    const url = new URL('https://staging.example/api/cases/case-a/permits');
    const response = await handleCasesApi(new Request(url, {
      method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ permit_type: 'health', issuing_authority: 'Authority' }),
    }), db, url, { ...owner, role: 'warehouse' });
    expect(response.status).toBe(403);
    expect(db.permits).toHaveLength(0);
  });

});