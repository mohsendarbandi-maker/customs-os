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
  permits: Array<Record<string, unknown>> = [];
  exitRecord: Record<string, unknown> | null = null;
  simulatePermitConflict = false;
  simulateCaseExitConflict = false;
  simulateExitConflict = false;
  related = { shipments: [] as unknown[], declarations: [] as unknown[], documents: [] as unknown[], permits: [] as unknown[] };
  auditEvents: Array<Record<string, unknown>> = [];
  queries: Array<{ sql: string; values: unknown[] }> = [];
  lastChanges = 0;
  simulateCaseConflict = false;
  clientRow: { id: string; organization_id: string } | null = { id: 'client-a', organization_id: 'org-a' };
  existingOrderId: string | null = null;
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
    if (sql.includes('FROM case_exit_operations WHERE case_id=? AND organization_id=?')) {
      return this.exitRecord?.case_id === values[0] && this.exitRecord.organization_id === values[1] ? this.exitRecord as T : null;
    }
    if (sql.includes('COUNT(*) AS total FROM permits WHERE case_id=? AND organization_id=?')) {
      const rows = [...this.related.permits, ...this.permits].filter(row => row.case_id === values[0] && row.organization_id === values[1] && row.status === 'pending');
      return { total: rows.length } as T;
    }
    if (sql.includes('FROM clients WHERE id=?')) {
      return this.clientRow?.id === values[0] && this.clientRow.organization_id === values[1]
        ? this.clientRow as T : null;
    }
    if (sql.includes('SELECT id FROM cases WHERE organization_id=? AND registration_order_no=?')) {
      return this.existingOrderId ? { id: this.existingOrderId } as T : null;
    }
    if (sql.includes('COUNT(*) AS total FROM cases c')) return { total: this.list.length } as T;
    if (sql.includes('FROM cases c LEFT JOIN clients cl')) {
      return this.detail && this.detail.id === values[0] && this.detailOrganizationId === values[1]
        ? this.detail as T : null;
    }
    throw new Error('Unexpected query: ' + sql);
  }
  run(sql: string, values: unknown[]): { meta?: { changes?: number } } {
    this.queries.push({ sql, values });
    if (sql.startsWith('INSERT INTO cases (')) {
      const [id, organizationId, clientId, caseNumber, status, registrationOrderNo, createdAt, updatedAt] = values;
      const registrationOrderExists = Boolean(registrationOrderNo) &&
        (this.existingOrderId !== null || this.detail?.registration_order_no === registrationOrderNo);
      if (registrationOrderExists) {
        this.lastChanges = 0;
        return { meta: { changes: 0 } };
      }
      this.detail = {
        id, case_number: caseNumber, status, client_id: clientId, client_name: 'بازرگانی الف',
        customs_office_id: null, registration_order_no: registrationOrderNo, proforma_no: null,
        cargo_description: null, cargo_count: null, cargo_count_unit: null, net_weight_kg: null,
        gross_weight_kg: null, warehouse_receipt_no: null, warehouse_receipt_date: null,
        release_status: 'pending', valuation_status: 'pending', unloading_date: null, vessel_type: null,
        customs_regime: null, origin_country_code: null, transaction_country_code: null, delivery_term: null,
        invoice_amount: null, invoice_currency: null, insurance_amount_irr: null, tariff_code: null,
        import_duty_rate: null, customs_fx_rate_irr: null, customs_value_irr: null,
        import_duty_irr: null, vat_irr: null, total_payable_irr: null,
        display_name: null, created_at: createdAt, updated_at: updatedAt,
        shipment_count: 0, latest_shipment_id: null, shipment_display_name: null,
        bill_of_lading_no: null, vessel_name: null, kottaj_number: null,
      } as unknown as CaseRecord;
      this.lastChanges = 1;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO case_exit_operations (')) {
      const [id, organizationId, caseId, exitStatus, permitNo, permitDate, authorizedAt, exitAt, vehiclePlate, driverName, driverNationalId, notes, createdBy, createdAt, updatedAt] = values;
      const expectedCaseUpdatedAt = values[17];
      const expectedCaseStatus = values[18];
      const expectedExitUpdatedAt = values[19];
      if (this.simulateCaseExitConflict && this.detail) {
        (this.detail as unknown as Record<string, unknown>).updated_at = '2026-11-26T09:01:00.000Z';
        this.simulateCaseExitConflict = false;
      }
      if (this.simulateExitConflict && this.exitRecord) {
        this.exitRecord.updated_at = '2026-11-26T09:02:00.000Z';
        this.simulateExitConflict = false;
      }
      const caseMatches = this.detail?.id === caseId && this.detailOrganizationId === organizationId &&
        this.detail.updated_at === expectedCaseUpdatedAt && this.detail.status === expectedCaseStatus;
      const exitMatches = this.exitRecord
        ? this.exitRecord.updated_at === expectedExitUpdatedAt
        : expectedExitUpdatedAt === null;
      if (!caseMatches || !exitMatches) {
        this.lastChanges = 0;
        return { meta: { changes: 0 } };
      }
      this.exitRecord = {
        id: this.exitRecord?.id || id, organization_id: organizationId, case_id: caseId, exit_status: exitStatus,
        exit_permit_no: permitNo, exit_permit_number: permitNo, exit_permit_date: permitDate,
        exit_authorized_at: authorizedAt, authorized_at: authorizedAt, exit_at: exitAt, exited_at: exitAt,
        vehicle_plate: vehiclePlate, driver_name: driverName, driver_national_id: driverNationalId,
        notes, created_by: createdBy, created_at: this.exitRecord?.created_at || createdAt, updated_at: updatedAt,
      };
      this.lastChanges = 1;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO permits (')) {
      this.permits.push({ id: values[0], organization_id: values[1], case_id: values[2], permit_type: values[3], permit_number: values[4], issuing_authority: values[5], status: values[6], issued_at: values[7], expires_at: values[8], created_at: values[9], updated_at: values[10] });
      this.lastChanges = 1;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE permits SET')) {
      const permitId = values[values.length - 4], caseId = values[values.length - 3], orgId = values[values.length - 2], updatedAt = values[values.length - 1];
      const existing = this.permits.find(item => item.id === permitId && item.case_id === caseId && item.organization_id === orgId);
      if (this.simulatePermitConflict && existing) { existing.updated_at = '2026-11-25T09:02:00.000Z'; this.simulatePermitConflict = false; }
      const row = existing?.updated_at === updatedAt ? existing : undefined;
      if (!row) { this.lastChanges = 0; return { meta: { changes: 0 } }; }
      const setPart = sql.split(' SET ')[1]?.split(' WHERE ')[0] || '';
      const columns = setPart.split(',').map(value => value.split('=')[0].trim());
      columns.forEach((column, index) => { row[column] = values[index]; });
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
    if (sql.startsWith('UPDATE cases SET status=?')) {
      const [status, updatedAt, caseId, organizationId, previousUpdatedAt, previousStatus] = values;
      if (!this.detail || this.detail.id !== caseId || this.detailOrganizationId !== organizationId ||
          this.detail.updated_at !== previousUpdatedAt || this.detail.status !== previousStatus || this.lastChanges !== 1) {
        this.lastChanges = 0;
        return { meta: { changes: 0 } };
      }
      (this.detail as unknown as Record<string, unknown>).status = status;
      (this.detail as unknown as Record<string, unknown>).updated_at = updatedAt;
      this.lastChanges = 1;
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
      const rows = [...this.related.permits, ...this.permits.filter(row => row.case_id === values[0] && row.organization_id === values[1])];
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
  origin_country_code: 'US', transaction_country_code: 'IR', delivery_term: 'CFR',
  invoice_amount: 100, invoice_currency: 'USD', insurance_amount_irr: 50, tariff_code: '1001',
  import_duty_rate: '10', customs_fx_rate_irr: null, customs_value_irr: null,
  import_duty_irr: null, vat_irr: null, total_payable_irr: null,
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
      permits: [{ id: 'permit-a', permit_type: 'health', status: 'approved' }],
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
    expect(body.permits).toEqual([{ id: 'permit-a', permit_type: 'health', status: 'approved' }]);
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

  it('creates an organization-scoped case and records its creation audit event', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/cases');
    const response = await handleCasesApi(new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ client_id: 'client-a', registration_order_no: 'RO-NEW' }),
    }), db, url, owner);
    const body = await response.json() as { ok: boolean; created: boolean; case: CaseRecord };
    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.created).toBe(true);
    expect(body.case.status).toBe('registration_order');
    expect(body.case.registration_order_no).toBe('RO-NEW');
    expect(db.auditEvents).toHaveLength(1);
    expect(db.auditEvents[0]).toMatchObject({
      organization_id: 'org-a', actor_user_id: 'user-a', action: 'create', entity_type: 'case',
    });
    expect(db.queries.some(q => q.sql.includes('FROM clients WHERE id=?') && q.values.join('|') === 'client-a|org-a')).toBe(true);
  });

  it('returns the existing case for a duplicate registration order instead of creating another', async () => {
    const db = new FakeD1();
    db.existingOrderId = 'case-existing';
    db.detail = { ...caseRow, id: 'case-existing' };
    const url = new URL('https://staging.example/api/cases');
    const response = await handleCasesApi(new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ client_id: 'client-a', registration_order_no: 'RO-1' }),
    }), db, url, owner);
    const body = await response.json() as { created: boolean; case: CaseRecord };
    expect(response.status).toBe(200);
    expect(body.created).toBe(false);
    expect(body.case.id).toBe('case-existing');
    expect(db.queries.some(q => q.sql.startsWith('INSERT INTO cases'))).toBe(false);
  });

  it('does not return an existing registration-order case to a different client', async () => {
    const db = new FakeD1();
    db.existingOrderId = 'case-existing';
    db.detail = { ...caseRow, id: 'case-existing', client_id: 'client-other' } as CaseRecord;
    db.list = [{ id: 'case-existing', registration_order_no: 'RO-1' }];
    const url = new URL('https://staging.example/api/cases');
    const response = await handleCasesApi(new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ client_id: 'client-a', registration_order_no: 'RO-1' }),
    }), db, url, owner);
    expect(response.status).toBe(409);
    expect(db.queries.some(q => q.sql.startsWith('INSERT INTO cases'))).toBe(false);
  });

  it('rejects case creation for a client outside the active organization', async () => {
    const db = new FakeD1();
    db.clientRow = { id: 'client-a', organization_id: 'org-other' };
    const url = new URL('https://staging.example/api/cases');
    const response = await handleCasesApi(new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ client_id: 'client-a' }),
    }), db, url, owner);
    expect(response.status).toBe(404);
    expect(db.queries.some(q => q.sql.startsWith('INSERT INTO cases'))).toBe(false);
  });

  it('updates operational data and only advances early cases to documents_ready', async () => {
    const db = new FakeD1();
    db.detail = {
      ...caseRow, organization_id: 'org-a', status: 'draft', warehouse_receipt_no: null,
      warehouse_receipt_date: null, unloading_date: null, updated_at: '2026-11-25T09:00:00.000Z',
    } as CaseRecord;
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({
        vessel_type: 'foreign', unloading_date: '2026-11-12',
        warehouse_receipt_no: 'WH-NEW', warehouse_receipt_date: '2026-11-11',
        origin_country_code: 'us', transaction_country_code: 'ir', delivery_term: 'cfr',
        invoice_amount: 250, invoice_currency: 'usd', insurance_amount_irr: 100,
        import_duty_rate: 5, tariff_code: '1001',
      }),
    }), db, url, owner);
    const body = await response.json() as { case: CaseRecord; stageAdvanced: boolean };
    expect(response.status).toBe(200);
    expect(body.case.status).toBe('documents_ready');
    expect(body.case.origin_country_code).toBe('US');
    expect(body.case.invoice_currency).toBe('USD');
    expect(body.case.warehouse_receipt_date).toBe('2026-11-11');
    expect(body.stageAdvanced).toBe(true);
    const audit = db.auditEvents[0];
    expect(JSON.parse(String(audit.after_json))).toMatchObject({ status: 'documents_ready', invoice_amount: 250 });
  });

  it('rejects an invalid ISO calendar date before performing any SQL write', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow, organization_id: 'org-a' } as CaseRecord;
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ warehouse_receipt_date: '2026-02-30' }),
    }), db, url, owner);
    expect(response.status).toBe(422);
    expect(db.queries.some(q => q.sql.startsWith('UPDATE cases SET'))).toBe(false);
  });

  it('calculates customs valuation with exact decimal arithmetic and audits the result', async () => {
    const db = new FakeD1();
    db.detail = {
      ...caseRow, organization_id: 'org-a', status: 'valuation',
      invoice_amount: 100, invoice_currency: 'USD', insurance_amount_irr: 50,
      updated_at: '2026-11-25T09:00:00.000Z',
    } as CaseRecord;
    const url = new URL('https://staging.example/api/cases/case-a/valuation');
    const response = await handleCasesApi(new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ customs_fx_rate_irr: '2', import_duty_rate: '10', vat_rate: '9' }),
    }), db, url, owner);
    const body = await response.json() as {
      ok: boolean; valuation: { customs_value_irr: string; import_duty_irr: string; vat_irr: string; total_payable_irr: string };
      case: CaseRecord;
    };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.valuation).toEqual({
      customs_value_irr: '250', import_duty_irr: '25', vat_irr: '24.75', total_payable_irr: '49.75',
      customs_fx_rate_irr: '2', import_duty_rate: '10', vat_rate: '9',
    });
    expect(body.case.status).toBe('duties_calculation');
    expect(body.case.valuation_status).toBe('calculated');
    expect(db.auditEvents).toHaveLength(1);
    expect(JSON.parse(String(db.auditEvents[0].after_json))).toMatchObject({
      status: 'duties_calculation', valuation_status: 'calculated', total_payable_irr: '49.75',
    });
  });

  it('requires invoice, currency and insurance before valuation and blocks stage regression', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow, organization_id: 'org-a', insurance_amount_irr: null } as CaseRecord;
    const url = new URL('https://staging.example/api/cases/case-a/valuation');
    const missingInsurance = await handleCasesApi(new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ customs_fx_rate_irr: 2, import_duty_rate: 10 }),
    }), db, url, owner);
    expect(missingInsurance.status).toBe(422);
    expect(db.queries.some(q => q.sql.startsWith('UPDATE cases SET'))).toBe(false);

    db.detail = { ...caseRow, organization_id: 'org-a', status: 'exit_permit' } as CaseRecord;
    const closed = await handleCasesApi(new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ customs_fx_rate_irr: 2, import_duty_rate: 10 }),
    }), db, url, owner);
    expect(closed.status).toBe(409);
    expect(db.queries.some(q => q.sql.startsWith('UPDATE cases SET'))).toBe(false);
  });

  it('rejects case creation and valuation for unauthorized roles', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/cases');
    const create = await handleCasesApi(new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify({ client_id: 'client-a' }),
    }), db, url, { ...owner, role: 'warehouse' });
    expect(create.status).toBe(403);
    expect(db.queries).toHaveLength(0);
    const valuationUrl = new URL('https://staging.example/api/cases/case-a/valuation');
    const valuation = await handleCasesApi(new Request(valuationUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: valuationUrl.origin },
      body: JSON.stringify({ customs_fx_rate_irr: 2, import_duty_rate: 10 }),
    }), db, valuationUrl, { ...owner, role: 'warehouse' });
    expect(valuation.status).toBe(403);
    expect(db.queries).toHaveLength(0);
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
    const afterSnapshot = JSON.parse(String(db.auditEvents.at(-1)?.after_json)) as { updated_at: string };
    expect(db.permits[0].updated_at).toBe(afterSnapshot.updated_at);
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

  it('does not overwrite a concurrent permit edit and records no false audit event', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    db.permits = [{
      id: 'permit-a', organization_id: 'org-a', case_id: 'case-a', permit_type: 'health',
      permit_number: 'H-1', issuing_authority: 'Authority', status: 'pending',
      issued_at: null, expires_at: null, created_at: '2026-11-25T08:00:00.000Z',
      updated_at: '2026-11-25T08:00:00.000Z',
    }];
    db.simulatePermitConflict = true;
    const url = new URL('https://staging.example/api/cases/case-a/permits/permit-a');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    }), db, url, owner);
    const body = await response.json() as { error: string };
    expect(response.status).toBe(409);
    expect(body.error).toBe('PERMIT_UPDATE_CONFLICT');
    expect(db.permits[0].status).toBe('pending');
    expect(db.auditEvents).toHaveLength(0);
  });

  it('rejects non-ISO permit timestamps before database writes', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    const url = new URL('https://staging.example/api/cases/case-a/permits');
    const response = await handleCasesApi(new Request(url, {
      method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        permit_type: 'health', issuing_authority: 'Authority',
        issued_at: '11/25/2026', expires_at: '2026-12-25',
      }),
    }), db, url, owner);
    expect(response.status).toBe(422);
    expect(db.permits).toHaveLength(0);
    expect(db.queries.some(query => query.sql.startsWith('INSERT INTO permits'))).toBe(false);
  });


  it('returns case exit state and exact completion blockers from D1', async () => {
    const db = new FakeD1();
    db.detail = {
      ...caseRow, status: 'exit_permit', kottaj_number: 'K-1405-1',
      release_status: 'released', warehouse_receipt_no: 'WH-1',
    };
    db.permits = [{
      id: 'permit-pending', organization_id: 'org-a', case_id: 'case-a', status: 'pending',
    }];
    db.exitRecord = {
      id: 'exit-a', organization_id: 'org-a', case_id: 'case-a', exit_status: 'authorized',
      exit_permit_no: 'EP-1', exit_permit_number: 'EP-1', exit_permit_date: '2026-11-26',
      exit_authorized_at: null, authorized_at: null, exit_at: null, exited_at: null,
      vehicle_plate: null, driver_name: null, driver_national_id: null, notes: null,
      created_by: 'user-a', created_at: '2026-11-26T08:00:00.000Z', updated_at: '2026-11-26T08:00:00.000Z',
    };
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(req('GET', url.pathname), db, url, owner);
    const body = await response.json() as {
      exit: Record<string, unknown>; readiness: { ready: boolean; pending_permits: number; issues: string[] };
    };
    expect(response.status).toBe(200);
    expect(body.exit.exit_permit_no).toBe('EP-1');
    expect(body.readiness.ready).toBe(false);
    expect(body.readiness.pending_permits).toBe(1);
    expect(body.readiness.issues).toContain('1 مجوز در انتظار تعیین تکلیف است');
    expect(db.queries.some(query => query.sql.includes('case_exit_operations'))).toBe(true);
  });

  it('does not reopen a completed case when a pending exit update is submitted', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow, status: 'completed', updated_at: '2026-11-26T08:00:00.000Z' };
    const url = new URL('https://staging.example/api/cases/case-a/exit');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ exit_status: 'pending' }),
    }), db, url, owner);
    const body = await response.json() as { error: string };
    expect(response.status).toBe(409);
    expect(body.error).toBe('CASE_ALREADY_COMPLETED');
    expect(db.exitRecord).toBeNull();
    expect(db.auditEvents).toHaveLength(0);
    expect(db.queries.some(query =>
      query.sql.startsWith('INSERT INTO case_exit_operations') || query.sql.startsWith('UPDATE cases SET status=') ||
      query.sql.startsWith('INSERT INTO customs_os_audit_events'),
    )).toBe(false);
  });

  it('rejects a stale case snapshot without writing exit data or audit', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow, status: 'duties_calculation', updated_at: '2026-11-26T08:00:00.000Z' };
    db.simulateCaseExitConflict = true;
    const url = new URL('https://staging.example/api/cases/case-a/exit');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ exit_status: 'authorized', exit_permit_no: 'EP-STALE' }),
    }), db, url, owner);
    const body = await response.json() as { error: string };
    expect(response.status).toBe(409);
    expect(body.error).toBe('CASE_EXIT_UPDATE_CONFLICT');
    expect(db.exitRecord).toBeNull();
    expect(db.auditEvents).toHaveLength(0);
    expect(db.detail?.status).toBe('duties_calculation');
  });

  it('rejects a stale exit-record snapshot without changing case stage or writing audit', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow, status: 'exit_permit', updated_at: '2026-11-26T08:00:00.000Z' };
    db.exitRecord = {
      id: 'exit-a', organization_id: 'org-a', case_id: 'case-a', exit_status: 'authorized',
      exit_permit_no: 'EP-OLD', exit_permit_date: null, exit_authorized_at: null, exit_at: null,
      vehicle_plate: null, driver_name: null, driver_national_id: null, notes: null,
      created_by: 'user-a', created_at: '2026-11-26T07:00:00.000Z', updated_at: '2026-11-26T07:30:00.000Z',
    };
    db.simulateExitConflict = true;
    const url = new URL('https://staging.example/api/cases/case-a/exit');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ exit_status: 'exited', exit_permit_no: 'EP-NEW', exit_at: '2026-11-26T08:15:00Z' }),
    }), db, url, owner);
    const body = await response.json() as { error: string };
    expect(response.status).toBe(409);
    expect(body.error).toBe('CASE_EXIT_UPDATE_CONFLICT');
    expect(db.exitRecord?.exit_status).toBe('authorized');
    expect(db.detail?.status).toBe('exit_permit');
    expect(db.auditEvents).toHaveLength(0);
  });

  it('authorizes case exit and advances duties-calculation to exit-permit with audit', async () => {
    const db = new FakeD1();
    db.detail = {
      ...caseRow, status: 'duties_calculation', kottaj_number: 'K-1405-1',
      release_status: 'released', warehouse_receipt_no: 'WH-1',
    };
    const url = new URL('https://staging.example/api/cases/case-a/exit');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        exit_status: 'authorized', exit_permit_no: 'EP-1405-1',
        exit_permit_date: '2026-11-26', vehicle_plate: '12الف345',
        driver_name: 'راننده', driver_national_id: '0012345678',
      }),
    }), db, url, owner);
    const body = await response.json() as { ok: boolean; case: CaseRecord; exit: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.case.status).toBe('exit_permit');
    expect(body.exit.exit_status).toBe('authorized');
    expect(body.exit.exit_permit_no).toBe('EP-1405-1');
    expect(db.auditEvents.at(-1)).toMatchObject({
      organization_id: 'org-a', actor_user_id: 'user-a', action: 'update',
      entity_type: 'case', entity_id: 'case-a',
    });
    expect(db.queries.find(query => query.sql.startsWith('UPDATE cases SET status=?'))?.values[0]).toBe('exit_permit');
  });

  it('allows final exit only from exit-permit stage and then marks the case completed', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow, status: 'exit_permit', kottaj_number: 'K-1405-1', release_status: 'released' };
    const url = new URL('https://staging.example/api/cases/case-a/exit');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ exit_status: 'exited', exit_at: '2026-11-26T10:30:00+03:30' }),
    }), db, url, owner);
    const body = await response.json() as { case: CaseRecord; exit: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(body.case.status).toBe('completed');
    expect(body.exit.exit_status).toBe('exited');
    expect(body.exit.exit_at).toBe('2026-11-26T07:00:00.000Z');
  });

  it('rejects final exit before the case reaches exit-permit stage without writing', async () => {
    const db = new FakeD1();
    db.detail = { ...caseRow, status: 'documents' };
    const url = new URL('https://staging.example/api/cases/case-a/exit');
    const response = await handleCasesApi(new Request(url, {
      method: 'PATCH', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ exit_status: 'exited' }),
    }), db, url, owner);
    const body = await response.json() as { error: string };
    expect(response.status).toBe(409);
    expect(body.error).toBe('CASE_EXIT_STAGE_REQUIRED');
    expect(db.exitRecord).toBeNull();
    expect(db.auditEvents).toHaveLength(0);
  });

  it('rejects case exit writes from a cross-origin request and for another tenant', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    const url = new URL('https://staging.example/api/cases/case-a/exit');
    const crossOrigin = await handleCasesApi(new Request(url, {
      method: 'PATCH', headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ exit_status: 'pending' }),
    }), db, url, owner);
    expect(crossOrigin.status).toBe(403);
    expect(db.exitRecord).toBeNull();

    const foreign = new FakeD1();
    foreign.detail = { ...caseRow, id: 'case-b' };
    foreign.detailOrganizationId = 'org-b';
    const foreignUrl = new URL('https://staging.example/api/cases/case-b/exit');
    const foreignResponse = await handleCasesApi(new Request(foreignUrl, {
      method: 'PATCH', headers: { origin: foreignUrl.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ exit_status: 'pending' }),
    }), foreign, foreignUrl, owner);
    expect(foreignResponse.status).toBe(404);
    expect(foreign.exitRecord).toBeNull();
  });

  it('rejects invalid exit dates and unauthorized roles before database writes', async () => {
    const db = new FakeD1();
    db.detail = caseRow;
    const url = new URL('https://staging.example/api/cases/case-a/exit');
    const invalidDate = await handleCasesApi(new Request(url, {
      method: 'PATCH', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ exit_status: 'pending', exit_permit_date: '26/11/2026' }),
    }), db, url, owner);
    expect(invalidDate.status).toBe(400);
    expect(db.exitRecord).toBeNull();

    const forbidden = await handleCasesApi(new Request(url, {
      method: 'PATCH', headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ exit_status: 'pending' }),
    }), db, url, { ...owner, role: 'accountant' });
    expect(forbidden.status).toBe(403);
    expect(db.exitRecord).toBeNull();
  });


  it('marks completion ready only when release, weights, valuation, permits and final exit all pass', async () => {
    const db = new FakeD1();
    db.detail = {
      ...caseRow, status: 'completed', kottaj_number: 'K-1405-1',
      warehouse_receipt_no: 'WH-1', release_status: 'released', valuation_status: 'calculated',
    };
    db.exitRecord = {
      id: 'exit-a', organization_id: 'org-a', case_id: 'case-a', exit_status: 'exited',
      exit_permit_no: 'EP-1', exit_permit_number: 'EP-1', exit_permit_date: '2026-11-26',
      exit_authorized_at: null, authorized_at: null, exit_at: '2026-11-26T07:00:00.000Z',
      exited_at: '2026-11-26T07:00:00.000Z', vehicle_plate: null, driver_name: null,
      driver_national_id: null, notes: null, created_by: 'user-a',
      created_at: '2026-11-26T08:00:00.000Z', updated_at: '2026-11-26T08:00:00.000Z',
    };
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(req('GET', url.pathname), db, url, owner);
    const body = await response.json() as { readiness: { ready: boolean; issues: string[]; release_ready: boolean } };
    expect(response.status).toBe(200);
    expect(body.readiness.ready).toBe(true);
    expect(body.readiness.issues).toEqual([]);
    expect(body.readiness.release_ready).toBe(true);
  });

  it('blocks completion when gross weight is below net weight', async () => {
    const db = new FakeD1();
    db.detail = {
      ...caseRow, status: 'completed', kottaj_number: 'K-1405-1',
      warehouse_receipt_no: 'WH-1', release_status: 'released', valuation_status: 'calculated',
      net_weight_kg: 21000, gross_weight_kg: 20000,
    };
    db.exitRecord = { id: 'exit-a', organization_id: 'org-a', case_id: 'case-a', exit_status: 'exited' };
    const url = new URL('https://staging.example/api/cases/case-a');
    const response = await handleCasesApi(req('GET', url.pathname), db, url, owner);
    const body = await response.json() as { readiness: { ready: boolean; issues: string[] } };
    expect(response.status).toBe(200);
    expect(body.readiness.ready).toBe(false);
    expect(body.readiness.issues).toContain('وزن ناخالص نمی‌تواند کمتر از وزن خالص باشد');
  });

});