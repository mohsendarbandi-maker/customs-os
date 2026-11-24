import { describe, expect, it } from 'vitest';
import {
  handleShipmentsApi,
  type ShipmentsD1Database,
  type ShipmentsD1Statement,
  type ShipmentsProfile,
} from './shipments-api';

type Row = Record<string, unknown>;
type ShipmentRow = Row & { id: string; organization_id: string; case_id: string | null; vessel_id: string | null; cargo_count: number | null };
class FakeStatement implements ShipmentsD1Statement {
  values: unknown[] = [];
  constructor(readonly sql: string, private readonly db: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Row>() { return this.db.first<T>(this.sql, this.values); }
  async all<T = Row>() { return this.db.all<T>(this.sql, this.values); }
  async run() { return { meta: { changes: this.db.run(this.sql, this.values) } }; }
}
const organizationId = 'ad95fdf1-e0e2-439b-92b0-c20ab07cacdd';
const profile: ShipmentsProfile = {
  id: 'owner-cloudflare-staging',
  organization_id: organizationId,
  role: 'owner',
  is_active: true,
};
const makeShipment = (overrides: Row = {}) => ({
  id: 'shipment-a',
  organization_id: organizationId,
  case_id: 'case-a',
  registration_order_id: null,
  client_id: 'client-a',
  vessel_id: 'vessel-a',
  transport_mode: 'sea',
  shipping_line: 'خط کشتیرانی',
  bill_of_lading_no: 'BL-1',
  bill_of_lading_year: 2026,
  voyage_no: 'V-1',
  origin_port: 'Shanghai',
  destination_port: 'Bandar Abbas',
  cargo_count: 10,
  cargo_count_unit: 'رول',
  net_weight_kg: 1000,
  gross_weight_kg: 1100,
  current_status: 'draft',
  current_location: null,
  display_name: '۱۰ رول',
  transport_documents_status: 'not_ready',
  release_invoice_payment_status: 'unpaid',
  created_at: '2026-11-24T00:00:00.000Z',
  updated_at: '2026-11-24T00:00:00.000Z',
  registration_order_no: null,
  customs_regime: null,
  sata_code: null,
  cargo_description: null,
  client_name: 'صاحب کالا',
  vessel_name: 'کشتی الف',
  ...overrides,
});
const input = (overrides: Row = {}) => ({
  clientId: 'client-a',
  shippingLine: 'خط کشتیرانی',
  billOfLading: 'BL-NEW',
  billOfLadingYear: 2026,
  voyageNo: 'V-2',
  vesselName: 'کشتی جدید',
  vesselImo: '1234567',
  vesselFlag: 'PA',
  originPort: 'Shanghai',
  destinationPort: 'Bandar Abbas',
  cargoCount: 15,
  cargoCountUnit: 'رول',
  netWeightKg: 1200,
  grossWeightKg: 1250,
  currentStatus: 'draft',
  currentLocation: 'در مسیر',
  transportDocumentsStatus: 'not_ready',
  releaseInvoicePaymentStatus: 'unpaid',
  registrationOrderNo: 'ORD-1',
  customsRegime: 'definitive_import',
  sataCode: 'SATA-1',
  cargoDescription: 'بار آزمایشی',
  ...overrides,
});
const request = (method: string, path: string, body?: unknown, origin = 'https://staging.example') =>
  new Request('https://staging.example' + path, {
    method,
    headers: {
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }),
      ...(method === 'GET' ? { accept: 'application/json' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const urlFor = (path: string) => new URL('https://staging.example' + path);

class FakeD1 implements ShipmentsD1Database {
  clients: Row[] = [{ id: 'client-a', organization_id: organizationId, name: 'صاحب کالا' }];
  cases: Row[] = [];
  vessels: Row[] = [];
  lines: Row[] = [{ id: 'line-a', organization_id: organizationId, name: 'خط کشتیرانی', name_fa: null }];
  orders: Row[] = [];
  shipments: Row[] = [];
  customs: Row[] = [];
  queries: Array<{ sql: string; values: unknown[] }> = [];
  batches: string[][] = [];
  prepare(sql: string) { return new FakeStatement(sql, this); }
  async batch(statements: ShipmentsD1Statement[]) {
    this.batches.push((statements as FakeStatement[]).map(item => item.sql));
    for (const statement of statements as FakeStatement[]) this.run(statement.sql, statement.values);
    return [];
  }
  private withNames(row: Row): Row {
    const client = this.clients.find(item => item.id === row.client_id && item.organization_id === row.organization_id);
    const vessel = this.vessels.find(item => item.id === row.vessel_id && item.organization_id === row.organization_id);
    const custom = this.customs.find(item => item.shipment_id === row.id && item.organization_id === row.organization_id);
    return {
      ...row,
      client_name: client?.name ?? null,
      vessel_name: vessel?.name ?? null,
      registration_order_no: custom?.registration_order_no ?? null,
      customs_regime: custom?.customs_regime ?? null,
      sata_code: custom?.sata_code ?? null,
      cargo_description: custom?.cargo_description ?? null,
    };
  }
  first<T>(sql: string, values: unknown[]): T | null {
    this.queries.push({ sql, values });
    if (sql.includes('SELECT COUNT(*) AS total FROM shipments')) {
      return { total: this.shipments.filter(row => row.organization_id === values[0]).length } as T;
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM registration_orders')) {
      return { total: this.orders.filter(row => row.organization_id === values[0]).length } as T;
    }
    if (sql.startsWith('SELECT id FROM clients WHERE id=? AND organization_id=?')) {
      const row = this.clients.find(item => item.id === values[0] && item.organization_id === values[1]);
      return row ? { id: row.id } as T : null;
    }
    if (sql.startsWith('SELECT id,order_number,client_id,case_id,is_closed FROM registration_orders')) {
      const row = this.orders.find(item => item.id === values[0] && item.organization_id === values[1]);
      return row as T || null;
    }
    if (sql.startsWith('SELECT id,client_id FROM cases WHERE id=?')) {
      const row = this.cases.find(item => item.id === values[0] && item.organization_id === values[1]);
      return row ? { id: row.id, client_id: row.client_id } as T : null;
    }
    if (sql.startsWith('SELECT id FROM cases WHERE id=?')) {
      const row = this.cases.find(item => item.id === values[0] && item.organization_id === values[1]);
      return row ? { id: row.id } as T : null;
    }
    if (sql.startsWith('SELECT id FROM shipments WHERE organization_id=?')) {
      const row = this.shipments.find(item =>
        item.organization_id === values[0] &&
        String(item.shipping_line || '').trim().toLowerCase() === String(values[1]).trim().toLowerCase() &&
        String(item.bill_of_lading_no || '').trim().toLowerCase() === String(values[2]).trim().toLowerCase() &&
        item.bill_of_lading_year === values[3] && item.id !== values[4]
      );
      return row ? { id: row.id } as T : null;
    }
    if (sql.startsWith('SELECT id FROM vessels WHERE organization_id=?')) {
      const row = this.vessels.find(item => item.organization_id === values[0] &&
        String(item.name).toLowerCase() === String(values[1]).toLowerCase());
      return row ? { id: row.id } as T : null;
    }
    if (sql.startsWith('SELECT id FROM shipping_lines WHERE organization_id=?')) {
      const row = this.lines.find(item => item.organization_id === values[0] &&
        (String(item.name).toLowerCase() === String(values[1]).toLowerCase() ||
          String(item.name_fa || '').toLowerCase() === String(values[2]).toLowerCase()));
      return row ? { id: row.id } as T : null;
    }
    if (sql.startsWith('SELECT name FROM clients WHERE id=?')) {
      const row = this.clients.find(item => item.id === values[0] && item.organization_id === values[1]);
      return row ? { name: row.name } as T : null;
    }
    if (sql.startsWith('SELECT s.id,s.organization_id')) {
      const row = this.shipments.find(item => item.id === values[0] && item.organization_id === values[1]);
      return row ? this.withNames(row) as T : null;
    }
    if (sql.startsWith('SELECT client_id FROM cases WHERE id=?')) {
      const row = this.cases.find(item => item.id === values[0] && item.organization_id === values[1]);
      return row ? { client_id: row.client_id } as T : null;
    }
    throw new Error('Unexpected first query: ' + sql);
  }
  all<T>(sql: string, values: unknown[]): { results: T[] } {
    this.queries.push({ sql, values });
    if (sql.startsWith('SELECT id,client_id,order_number,case_id,is_closed,bank_name')) {
      const organization = String(values[0]);
      const limit = Number(values[1]);
      const offset = Number(values[2]);
      const results = this.orders
        .filter(row => row.organization_id === organization)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(offset, offset + limit)
        .map(row => ({ ...row }));
      return { results: results as T[] };
    }
    if (sql.startsWith('SELECT s.id,s.organization_id')) {
      const organization = String(values[0]);
      const results = this.shipments
        .filter(row => row.organization_id === organization)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map(row => this.withNames(row));
      return { results: results as T[] };
    }
    throw new Error('Unexpected all query: ' + sql);
  }
  run(sql: string, values: unknown[]): number {
    this.queries.push({ sql, values });
    if (sql.startsWith('INSERT INTO vessels')) {
      const [id, organization_id, name, imo_number, flag_code, shipping_line_id, created_at] = values;
      this.vessels.push({ id, organization_id, name, imo_number, flag_code, shipping_line_id, created_at });
      return 1;
    }
    if (sql.startsWith('INSERT INTO cases')) {
      const [id, organization_id, client_id, status, registration_order_no, cargo_count, cargo_count_unit,
        cargo_description, net_weight_kg, gross_weight_kg, display_name, created_at, updated_at] = values;
      this.cases.push({ id, organization_id, client_id, status, registration_order_no, cargo_count,
        cargo_count_unit, cargo_description, net_weight_kg, gross_weight_kg, display_name, created_at, updated_at });
      return 1;
    }
    if (sql.startsWith('INSERT INTO shipments')) {
      const [id, organization_id, case_id, registration_order_id, client_id, vessel_id, transport_mode,
        shipping_line, bill_of_lading_no, bill_of_lading_year, voyage_no, origin_port, destination_port,
        cargo_count, cargo_count_unit, net_weight_kg, gross_weight_kg, current_status, current_location,
        display_name, transport_documents_status, release_invoice_payment_status, ship_passed, created_at, updated_at] = values;
      this.shipments.push({ id, organization_id, case_id, registration_order_id, client_id, vessel_id,
        transport_mode, shipping_line, bill_of_lading_no, bill_of_lading_year, voyage_no, origin_port,
        destination_port, cargo_count, cargo_count_unit, net_weight_kg, gross_weight_kg, current_status,
        current_location, display_name, transport_documents_status, release_invoice_payment_status,
        ship_passed, created_at, updated_at });
      return 1;
    }
    if (sql.startsWith('INSERT INTO shipment_customs_data')) {
      const [shipment_id, organization_id, registration_order_no, package_count, cargo_description,
        net_weight_kg, gross_weight_kg, sata_code, customs_regime, created_by, created_at, updated_at] = values;
      this.customs.push({ shipment_id, organization_id, registration_order_no, package_count,
        cargo_description, net_weight_kg, gross_weight_kg, sata_code, customs_regime, created_by, created_at, updated_at });
      return 1;
    }
    if (sql.startsWith('UPDATE shipments SET')) {
      const [registration_order_id, client_id, vessel_id, shipping_line, bill_of_lading_no,
        bill_of_lading_year, voyage_no, origin_port, destination_port, cargo_count, cargo_count_unit,
        net_weight_kg, gross_weight_kg, current_status, current_location, display_name,
        transport_documents_status, release_invoice_payment_status, updated_at, id, organization_id] = values;
      const row = this.shipments.find(item => item.id === id && item.organization_id === organization_id);
      if (!row) return 0;
      Object.assign(row, { registration_order_id, client_id, vessel_id, shipping_line, bill_of_lading_no,
        bill_of_lading_year, voyage_no, origin_port, destination_port, cargo_count, cargo_count_unit,
        net_weight_kg, gross_weight_kg, current_status, current_location, display_name,
        transport_documents_status, release_invoice_payment_status, updated_at });
      return 1;
    }
    if (sql.startsWith('INSERT INTO shipment_customs_data')) {
      return 1;
    }
    throw new Error('Unexpected write query: ' + sql);
  }
}
describe('Cloudflare D1 shipments API', () => {
  it('lists only the current organization registration orders without external allocation tables', async () => {
    const db = new FakeD1();
    db.orders = [
      { id: 'order-a', organization_id: organizationId, client_id: 'client-a', order_number: 'ORD-1',
        case_id: 'case-a', is_closed: 0, bank_name: 'Bank A', bank_branch: 'Main',
        bank_branch_code: '001', payment_instrument_code: 'LC-1', created_at: '2026-01-01' },
      { id: 'order-private', organization_id: 'another-org', client_id: 'client-private', order_number: 'PRIVATE',
        case_id: null, is_closed: 0, bank_name: null, bank_branch: null,
        bank_branch_code: null, payment_instrument_code: null, created_at: '2026-01-02' },
    ];
    const url = urlFor('/api/shipments/registration-orders?limit=10&offset=0');
    const response = await handleShipmentsApi(request('GET', url.pathname + url.search), db, url, profile);
    const body = await response.json() as { ok: boolean; total: number; items: Array<{ id: string; is_closed: boolean }> };
    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items).toEqual([expect.objectContaining({ id: 'order-a', is_closed: false })]);
    expect(db.queries.every(query => query.values.includes(organizationId))).toBe(true);
    expect(db.queries.every(query => !query.sql.includes('registration_order_external_allocations'))).toBe(true);
  });
  it('blocks inactive and unsupported roles before any query', async () => {
    const db = new FakeD1();
    const url = urlFor('/api/shipments');
    const response = await handleShipmentsApi(request('GET', url.pathname), db, url, { ...profile, role: 'client' });
    expect(response.status).toBe(403);
    expect(db.queries).toHaveLength(0);
  });
  it('lists only the active organization and applies server-side pagination metadata', async () => {
    const db = new FakeD1();
    db.shipments = [
      makeShipment({ id: 'one', created_at: '2026-01-01T00:00:00Z' }),
      makeShipment({ id: 'private', organization_id: 'another-org' }),
    ];
    const url = urlFor('/api/shipments?limit=10&offset=0');
    const response = await handleShipmentsApi(request('GET', url.pathname + url.search), db, url, profile);
    const body = await response.json() as { ok: boolean; total: number; items: ShipmentRow[] };
    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items.map(item => item.id)).toEqual(['one']);
    expect(db.queries.every(query => query.values.includes(organizationId))).toBe(true);
  });
  it('creates a new case, vessel, shipment and customs metadata in one D1 batch', async () => {
    const db = new FakeD1();
    const url = urlFor('/api/shipments');
    const response = await handleShipmentsApi(request('POST', url.pathname, input()), db, url, profile);
    const body = await response.json() as { ok: boolean; shipment: ShipmentRow };
    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.shipment.organization_id).toBe(organizationId);
    expect(body.shipment.case_id).toBeTruthy();
    expect(body.shipment.vessel_id).toBeTruthy();
    expect(db.shipments).toHaveLength(1);
    expect(db.cases).toHaveLength(1);
    expect(db.vessels).toHaveLength(1);
    expect(db.customs[0].sata_code).toBe('SATA-1');
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0].some(sql => sql.startsWith('INSERT INTO shipments'))).toBe(true);
  });
  it('rejects a cross-organization client before writing', async () => {
    const db = new FakeD1();
    const url = urlFor('/api/shipments');
    const response = await handleShipmentsApi(request('POST', url.pathname, input({ clientId: 'client-private' })), db, url, profile);
    expect(response.status).toBe(404);
    expect(db.shipments).toHaveLength(0);
    expect(db.batches).toHaveLength(0);
  });
  it('rejects gross weight lower than net weight and cross-origin mutations', async () => {
    const db = new FakeD1();
    const url = urlFor('/api/shipments');
    const invalid = await handleShipmentsApi(
      request('POST', url.pathname, input({ grossWeightKg: 900 })), db, url, profile,
    );
    expect(invalid.status).toBe(400);
    const crossOrigin = await handleShipmentsApi(
      request('POST', url.pathname, input(), 'https://attacker.example'), db, url, profile,
    );
    expect(crossOrigin.status).toBe(403);
    expect(db.shipments).toHaveLength(0);
  });
  it('updates only the shipment owned by the active organization', async () => {
    const db = new FakeD1();
    db.shipments.push(makeShipment({ id: 'shipment-a' }));
    db.clients.push({ id: 'client-b', organization_id: organizationId, name: 'صاحب کالای دوم' });
    db.vessels.push({ id: 'vessel-a', organization_id: organizationId, name: 'کشتی الف' });
    const url = urlFor('/api/shipments/shipment-a');
    const response = await handleShipmentsApi(
      request('PATCH', url.pathname, input({ vesselName: 'کشتی الف', cargoCount: 25 })), db, url, profile,
    );
    const body = await response.json() as { shipment: ShipmentRow };
    expect(response.status).toBe(200);
    expect(body.shipment.id).toBe('shipment-a');
    expect(body.shipment.cargo_count).toBe(25);
    expect(db.shipments[0].organization_id).toBe(organizationId);
  });
  it('returns 404 when an identifier belongs to another organization', async () => {
    const db = new FakeD1();
    db.shipments.push(makeShipment({ id: 'foreign', organization_id: 'another-org' }));
    const url = urlFor('/api/shipments/foreign');
    const response = await handleShipmentsApi(request('PATCH', url.pathname, input()), db, url, profile);
    expect(response.status).toBe(404);
    expect(db.shipments[0].bill_of_lading_no).toBe('BL-1');
  });
  it('does not expose a delete operation', async () => {
    const db = new FakeD1();
    const url = urlFor('/api/shipments/shipment-a');
    const response = await handleShipmentsApi(request('DELETE', url.pathname), db, url, profile);
    expect(response.status).toBe(405);
  });
});
