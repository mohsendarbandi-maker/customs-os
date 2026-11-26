import { describe, expect, it } from 'vitest';
import {
  handleDeclarationExitApi,
  type DeclarationExitD1Database,
  type DeclarationExitD1Statement,
} from './declaration-exit-api';

type Row = Record<string, unknown>;
const declaration = {
  id: 'declaration-1',
  organization_id: 'org-1',
  case_id: 'case-1',
  shipment_id: 'shipment-1',
  linked_shipment_id: 'shipment-1',
  kottaj_number: '14050012345',
  customs_regime: 'import_definitive',
  customs_path: 'red',
  workflow_stage: 5,
  tariff_code: null,
  cargo_description: 'ذرت دامی',
  sata_code: null,
  ship_passed: 0,
  transport_documents_status: 'ready',
  transport_mode: 'sea',
  warehouse_receipt_no: 'WH-10',
};
const owner = { id: 'owner-1', organization_id: 'org-1', role: 'owner', is_active: true };
const accountant = { id: 'accountant-1', organization_id: 'org-1', role: 'accountant', is_active: true };
const makeRequest = (method: string, path: string, body?: unknown) => new Request(
  'https://staging.example' + path,
  {
    method,
    headers: body === undefined
      ? { origin: 'https://staging.example' }
      : { origin: 'https://staging.example', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  },
);
class Statement implements DeclarationExitD1Statement {
  private values: unknown[] = [];
  constructor(private readonly db: FakeD1, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Row>() { return this.db.first<T>(this.sql, this.values); }
  async all<T = Row>() { return this.db.all<T>(this.sql, this.values); }
  async run() { return this.db.run(this.sql, this.values); }
}
class FakeD1 implements DeclarationExitD1Database {
  declaration: Row | null = { ...declaration };
  workflow: Row | null = null;
  checklist: Row[] = [];
  exitItems: Row[] = [];
  shipmentFinanceStatus = 'pending';
  writes: string[] = [];
  prepare(sql: string) { return new Statement(this, sql); }
  async batch(statements: DeclarationExitD1Statement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
  first<T>(sql: string, values: unknown[]): T | null {
    if (sql.includes('FROM customs_declarations d')) {
      return this.declaration && this.declaration.id === values[0] &&
        this.declaration.organization_id === values[1] ? { ...this.declaration } as T : null;
    }
    if (sql.includes('FROM customs_declaration_workflow WHERE')) {
      return this.workflow && this.workflow.declaration_id === values[0] &&
        this.workflow.organization_id === values[1] ? { ...this.workflow } as T : null;
    }
    if (sql.includes('FROM declaration_exit_checklist_items')) {
      return (this.exitItems.find(row => row.declaration_id === values[0] &&
        row.organization_id === values[1] && row.item_key === values[2]) || null) as T | null;
    }
    if (sql.includes('FROM customs_operation_learning_events')) return null;
    if (sql.includes('SELECT COUNT(*) AS total')) return { total: 0 } as T;
    if (sql.includes('FROM customs_operation_rules')) return null;
    throw new Error('Unexpected first query: ' + sql);
  }
  all<T>(sql: string, values: unknown[]): { results: T[] } {
    if (sql.includes('PRAGMA table_info(shipments)')) return { results: [{ name: 'finance_status' }] as T[] };
    if (sql.includes('FROM declaration_checklist_items')) {
      return { results: this.checklist.filter(row =>
        row.declaration_id === values[0] && row.organization_id === values[1],
      ) as T[] };
    }
    if (sql.includes('FROM declaration_exit_checklist_items')) {
      return { results: this.exitItems.filter(row =>
        row.declaration_id === values[0] && row.organization_id === values[1],
      ) as T[] };
    }
    if (sql.includes('FROM customs_operation_learning_events')) return { results: [] as T[] };
    throw new Error('Unexpected all query: ' + sql);
  }
  run(sql: string, values: unknown[]) {
    this.writes.push(sql);
    if (sql.includes('INSERT OR IGNORE INTO declaration_checklist_items')) {
      const [id, organization_id, declaration_id, item_key, item_label, sort_order, created_at, updated_at] = values;
      if (!this.checklist.some(row => row.declaration_id === declaration_id && row.item_key === item_key)) {
        this.checklist.push({
          id, organization_id, declaration_id, item_key, item_label, completed: 0,
          note: null, sort_order, source: 'system', is_active: 1, created_at, updated_at,
        });
      }
      return { meta: { changes: 1 } };
    }
    if (sql.includes('INSERT OR IGNORE INTO declaration_exit_checklist_items')) {
      const [id, organization_id, declaration_id, item_key, created_at, updated_at] = values;
      if (!this.exitItems.some(row => row.declaration_id === declaration_id && row.item_key === item_key)) {
        this.exitItems.push({
          id, organization_id, declaration_id, item_key, completed: 0,
          completed_at: null, completed_by: null, created_at, updated_at,
        });
      }
      return { meta: { changes: 1 } };
    }
    if (sql.includes('UPDATE shipments SET finance_status')) {
      this.shipmentFinanceStatus = 'ready';
      return { meta: { changes: 1 } };
    }
    if (sql.includes('UPDATE customs_declarations SET workflow_stage=6')) {
      if (this.declaration) this.declaration.workflow_stage = 6;
      return { meta: { changes: 1 } };
    }
    if (sql.includes('INSERT INTO shipment_customs_data')) return { meta: { changes: 1 } };
    if (sql.includes('UPDATE customs_declaration_workflow SET current_stage')) return { meta: { changes: 1 } };
    if (sql.includes('INSERT INTO customs_os_audit_events')) return { meta: { changes: 1 } };
    throw new Error('Unexpected run query: ' + sql);
  }
}
const parse = async (response: Response) => response.json() as Promise<Row>;

describe('Cloudflare D1 declaration exit API', () => {
  it('returns 404 for a declaration owned by a different organization', async () => {
    const db = new FakeD1();
    db.declaration = { ...declaration, organization_id: 'other-org' };
    const path = '/api/declarations/declaration-1/exit';
    const response = await handleDeclarationExitApi(
      makeRequest('GET', path), db, new URL('https://staging.example' + path), owner,
    );
    expect(response.status).toBe(404);
    expect(db.writes).toHaveLength(0);
  });

  it('denies accountant writes while preserving read access', async () => {
    const db = new FakeD1();
    const path = '/api/declarations/declaration-1/exit/checklist';
    const response = await handleDeclarationExitApi(
      makeRequest('POST', path, { item_key: 'warehouse_invoice_initial', completed: true }),
      db, new URL('https://staging.example' + path), accountant,
    );
    expect(response.status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it('rejects an exit checklist key not in the three canonical items', async () => {
    const db = new FakeD1();
    const path = '/api/declarations/declaration-1/exit/checklist';
    const response = await handleDeclarationExitApi(
      makeRequest('POST', path, { item_key: 'other', completed: true }),
      db, new URL('https://staging.example' + path), owner,
    );
    const body = await parse(response);
    expect(response.status).toBe(422);
    expect(body.error).toBe('INVALID_EXIT_CHECKLIST_ITEM');
    expect(db.writes).toHaveLength(0);
  });

  it('initializes the eight active operations checklist items and three exit items idempotently on read', async () => {
    const db = new FakeD1();
    const path = '/api/declarations/declaration-1/exit';
    const response = await handleDeclarationExitApi(
      makeRequest('GET', path), db, new URL('https://staging.example' + path), owner,
    );
    const body = await parse(response);
    expect(response.status).toBe(200);
    expect(body.exitItems).toHaveLength(3);
    expect(body.checklistItems).toHaveLength(8);
    expect(db.checklist).toHaveLength(8);
    expect(db.exitItems).toHaveLength(3);
    expect((body.declaration as Row).organization_id).toBe('org-1');
  });

  it('allows stage 5 to advance to stage 6 with remaining checklist items recorded', async () => {
    const db = new FakeD1();
    const path = '/api/declarations/declaration-1/exit/advance';
    const response = await handleDeclarationExitApi(
      makeRequest('POST', path, {}), db, new URL('https://staging.example' + path), owner,
    );
    const body = await parse(response);
    expect(response.status).toBe(200);
    expect(body.workflow_stage).toBe(6);
    expect(body.partial_allowed).toBe(true);
    expect((body.remaining_items as unknown[]).length).toBe(8);
    expect(db.declaration?.workflow_stage).toBe(6);
  });

  it('does not release a shipment to finance while any required exit item is incomplete', async () => {
    const db = new FakeD1();
    const path = '/api/declarations/declaration-1/exit/complete';
    const response = await handleDeclarationExitApi(
      makeRequest('POST', path, { sata_code: '12345' }),
      db, new URL('https://staging.example' + path), owner,
    );
    const body = await parse(response);
    expect(response.status).toBe(200);
    expect(body.ready).toBe(false);
    expect(Array.isArray(body.issues)).toBe(true);
    expect(db.writes.some(sql => sql.includes('UPDATE shipments SET finance_status'))).toBe(false);
  });

  it('releases a complete non-definitive declaration to finance and records an audit event', async () => {
    const db = new FakeD1();
    if (db.declaration) db.declaration.customs_regime = 'export_definitive';
    const readPath = '/api/declarations/declaration-1/exit';
    await handleDeclarationExitApi(
      makeRequest('GET', readPath), db, new URL('https://staging.example' + readPath), owner,
    );
    db.exitItems = db.exitItems.map(item => ({ ...item, completed: 1 }));
    const path = '/api/declarations/declaration-1/exit/complete';
    const response = await handleDeclarationExitApi(
      makeRequest('POST', path, { sata_code: '12345' }),
      db, new URL('https://staging.example' + path), owner,
    );
    const body = await parse(response);
    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.finance_status).toBe('ready');
    expect(db.shipmentFinanceStatus).toBe('ready');
    expect(db.writes.some(sql => sql.includes('INSERT INTO customs_os_audit_events'))).toBe(true);
  });

  it('does not allow a declaration to advance from an unsupported workflow stage', async () => {
    const db = new FakeD1();
    if (db.declaration) db.declaration.workflow_stage = 3;
    const path = '/api/declarations/declaration-1/exit/advance';
    const response = await handleDeclarationExitApi(
      makeRequest('POST', path, {}), db, new URL('https://staging.example' + path), owner,
    );
    const body = await parse(response);
    expect(response.status).toBe(409);
    expect(body.error).toBe('DECLARATION_STAGE_NOT_ADVANCEABLE');
    expect(db.writes).toHaveLength(0);
  });
});
