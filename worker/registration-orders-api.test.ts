import { describe, expect, it } from 'vitest';
import {
  handleRegistrationOrdersApi,
  type RegistrationOrderD1Database,
  type RegistrationOrderD1Statement,
  type RegistrationOrdersProfile,
} from './registration-orders-api';

type Row = Record<string, unknown>;
class FakeStatement implements RegistrationOrderD1Statement {
  values: unknown[] = [];
  constructor(readonly sql: string, private readonly db: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T = Row>() { return this.db.first<T>(this.sql, this.values); }
  async all<T = Row>() { return this.db.all<T>(this.sql, this.values); }
  async run() { return { meta: { changes: this.db.run(this.sql, this.values) } }; }
}
const baseOrder = (overrides: Row = {}) => ({
  id: 'order-a', organization_id: 'org-a', case_id: null, client_id: 'client-a',
  order_number: '12345', order_date: '2026-01-01', status: 'received', tariff_code: null,
  quantity: null, quantity_unit: null, value_amount: 500, currency: 'USD', notes: null,
  net_weight_kg: 1000, gross_weight_kg: 1100, bank_name: 'Bank A', bank_branch: 'Main',
  bank_branch_code: '001', payment_instrument_code: 'LC-1', is_closed: 0, closed_at: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  client_name: 'شرکت الف', shipment_count: 1, shipped_net_weight_kg: 500,
  shipped_gross_weight_kg: 550, shipped_value_amount: 250,
  shipments_missing_invoice_value: 0, shipments_with_currency_mismatch: 0,
  external_allocation_count: 0, external_allocated_net_weight_kg: 0,
  external_allocated_gross_weight_kg: 0, external_allocated_value_amount: 0,
  external_allocations_missing_value: 0, external_allocations_currency_mismatch: 0,
  total_allocated_net_weight_kg: 500, total_allocated_gross_weight_kg: 550,
  total_allocated_value_amount: 250, total_allocation_count: 1,
  ...overrides,
});
const profile: RegistrationOrdersProfile = {
  id: 'user-a', organization_id: 'org-a', role: 'owner', is_active: true,
};
const makeRequest = (method: string, path: string, body?: unknown, origin = 'https://staging.example') =>
  new Request('https://staging.example' + path, {
    method,
    headers: {
      ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const orderInput = (overrides: Row = {}) => ({
  client_id: 'client-a', order_number: '98765', order_date: '2026-01-02',
  status: 'received', tariff_code: '1001', quantity: 100, quantity_unit: 'MT',
  net_weight_kg: 1000, gross_weight_kg: 1100, value_amount: 500, currency: 'USD',
  bank_name: 'Bank A', bank_branch: 'Main', bank_branch_code: '001',
  payment_instrument_code: 'LC-2', notes: 'master registration order',
  ...overrides,
});
const allocationInput = (overrides: Row = {}) => ({
  recipient_company: 'شرکت مقصد', destination_customs: 'گمرک بندرعباس',
  allocation_reference: 'OUT-1', status: 'allocated', net_weight_kg: 300,
  gross_weight_kg: 330, value_amount: 150, currency: 'USD', notes: null,
  ...overrides,
});

class FakeD1 implements RegistrationOrderD1Database {
  orders: Row[] = [];
  cases: Row[] = [];
  clients = new Set(['client-a']);
  allocations: Row[] = [];
  audit: Row[] = [];
  currencyMismatches = 0;
  clientConflicts = 0;
  queries: Array<{ sql: string; values: unknown[] }> = [];

  prepare(sql: string) { return new FakeStatement(sql, this); }
  async batch(statements: RegistrationOrderD1Statement[]) {
    let previousChanges = 0;
    const results = [];
    for (const statement of statements as FakeStatement[]) {
      previousChanges = this.run(statement.sql, statement.values, previousChanges);
      results.push({ meta: { changes: previousChanges } });
    }
    return results;
  }
  first<T>(sql: string, values: unknown[]): T | null {
    this.queries.push({ sql, values });
    if (sql.includes('SELECT COUNT(*) AS total FROM registration_orders')) {
      return { total: this.orders.filter(row => row.organization_id === values[0]).length } as T;
    }
    if (sql.startsWith('SELECT id FROM clients WHERE id = ? AND organization_id = ?')) {
      return this.clients.has(String(values[0])) && values[1] === 'org-a' ? { id: String(values[0]) } as T : null;
    }
    if (sql.startsWith('SELECT id FROM registration_orders WHERE organization_id = ? AND order_number = ?')) {
      const row = this.orders.find(item => item.organization_id === values[0] &&
        item.order_number === values[1] && item.id !== values[2]);
      return row ? { id: row.id } as T : null;
    }
    if (sql.startsWith('SELECT ro.id')) {
      const row = this.orders.find(item => item.id === values[0] && item.organization_id === values[1]);
      return row as T || null;
    }
    if (sql.includes('SELECT COUNT(s.id) AS total FROM registration_orders ro')) {
      return { total: this.currencyMismatches } as T;
    }
    if (sql.includes('SELECT COUNT(*) AS total FROM registration_order_external_allocations')) {
      return { total: this.currencyMismatches } as T;
    }
    if (sql.includes('SELECT COUNT(s.id) AS total FROM shipments s')) {
      return { total: this.clientConflicts } as T;
    }
    if (sql.includes('FROM registration_order_external_allocations WHERE id = ?')) {
      const row = this.allocations.find(item => item.id === values[0] &&
        item.registration_order_id === values[1] && item.organization_id === values[2]);
      return row as T || null;
    }
    throw new Error('Unexpected first query: ' + sql);
  }
  all<T>(sql: string, values: unknown[]): { results: T[] } {
    this.queries.push({ sql, values });
    if (sql.includes('FROM cases WHERE organization_id = ?')) {
      return { results: this.cases.filter(row => row.organization_id === values[0]) as T[] };
    }
    if (sql.startsWith('SELECT ro.id')) {
      return { results: this.orders.filter(row => row.organization_id === values[0]) as T[] };
    }
    if (sql.includes('FROM registration_order_external_allocations WHERE registration_order_id = ?')) {
      return { results: this.allocations.filter(row => row.registration_order_id === values[0] && row.organization_id === values[1]) as T[] };
    }
    throw new Error('Unexpected all query: ' + sql);
  }
  run(sql: string, values: unknown[], previousChanges = 0): number {
    this.queries.push({ sql, values });
    if (sql.startsWith('INSERT INTO registration_orders')) {
      const [id, organizationId, orderNumber, orderDate, status, tariffCode, quantity, quantityUnit,
        valueAmount, currency, notes, createdAt, updatedAt, clientId, netWeight, grossWeight,
        bankName, bankBranch, bankBranchCode, paymentCode] = values;
      this.orders.push(baseOrder({
        id, organization_id: organizationId, order_number: orderNumber, order_date: orderDate,
        status, tariff_code: tariffCode, quantity, quantity_unit: quantityUnit, value_amount: valueAmount,
        currency, notes, created_at: createdAt, updated_at: updatedAt, client_id: clientId,
        net_weight_kg: netWeight, gross_weight_kg: grossWeight, bank_name: bankName,
        bank_branch: bankBranch, bank_branch_code: bankBranchCode, payment_instrument_code: paymentCode,
        client_name: 'شرکت الف', shipment_count: 0, shipped_net_weight_kg: 0,
        shipped_gross_weight_kg: 0, shipped_value_amount: 0, total_allocated_net_weight_kg: 0,
        total_allocated_gross_weight_kg: 0, total_allocated_value_amount: 0, total_allocation_count: 0,
      }));
      return 1;
    }
    if (sql.startsWith('UPDATE registration_orders SET client_id')) {
      const [clientId, orderNumber, orderDate, status, tariffCode, quantity, quantityUnit,
        valueAmount, currency, notes, netWeight, grossWeight, bankName, bankBranch, bankCode,
        paymentCode, updatedAt, id, organizationId] = values;
      const row = this.orders.find(item => item.id === id && item.organization_id === organizationId);
      if (!row) return 0;
      Object.assign(row, {
        client_id: clientId, order_number: orderNumber, order_date: orderDate, status,
        tariff_code: tariffCode, quantity, quantity_unit: quantityUnit, value_amount: valueAmount,
        currency, notes, net_weight_kg: netWeight, gross_weight_kg: grossWeight,
        bank_name: bankName, bank_branch: bankBranch, bank_branch_code: bankCode,
        payment_instrument_code: paymentCode, updated_at: updatedAt,
      });
      return 1;
    }
    if (sql.startsWith('UPDATE registration_orders SET is_closed')) {
      const [closed, closedAt, status, updatedAt, id, organizationId] = values;
      const row = this.orders.find(item => item.id === id && item.organization_id === organizationId);
      if (!row) return 0;
      Object.assign(row, { is_closed: closed, closed_at: closedAt, status, updated_at: updatedAt });
      return 1;
    }
    if (sql.startsWith('INSERT INTO registration_order_external_allocations')) {
      const [id, organizationId, orderId, recipient, destination, reference, status, net, gross,
        value, currency, notes, createdBy, createdAt, updatedAt] = values;
      this.allocations.push({
        id, organization_id: organizationId, registration_order_id: orderId,
        recipient_company: recipient, destination_customs: destination, allocation_reference: reference,
        status, net_weight_kg: net, gross_weight_kg: gross, value_amount: value, currency,
        notes, created_by: createdBy, created_at: createdAt, updated_at: updatedAt,
      });
      return 1;
    }
    if (sql.startsWith('UPDATE registration_order_external_allocations SET')) {
      const [recipient, destination, reference, status, net, gross, value, currency, notes, updatedAt,
        id, orderId, organizationId] = values;
      const row = this.allocations.find(item => item.id === id && item.registration_order_id === orderId && item.organization_id === organizationId);
      if (!row) return 0;
      Object.assign(row, {
        recipient_company: recipient, destination_customs: destination, allocation_reference: reference,
        status, net_weight_kg: net, gross_weight_kg: gross, value_amount: value, currency, notes,
        updated_at: updatedAt,
      });
      return 1;
    }
    if (sql.startsWith('INSERT INTO customs_os_audit_events')) {
      if (!sql.includes('WHERE changes() > 0') || previousChanges > 0) {
        const [id, organizationId, actorUserId, action, entityType, entityId, beforeJson, afterJson, requestId, createdAt] = values;
        this.audit.push({
          id, organization_id: organizationId, actor_user_id: actorUserId, action, entity_type: entityType,
          entity_id: entityId, before_json: beforeJson, after_json: afterJson, request_id: requestId, created_at: createdAt,
        });
      }
      return 1;
    }
    throw new Error('Unexpected write query: ' + sql);
  }
}

describe('Cloudflare D1 registration-orders API', () => {
  it('requires an active authorized profile and rejects client-only access', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/registration-orders');
    const response = await handleRegistrationOrdersApi(
      makeRequest('GET', url.pathname), db, url, { ...profile, role: 'client' },
    );
    expect(response.status).toBe(403);
    expect(db.queries).toHaveLength(0);
  });

  it('lists only the current organization and returns cases and reconciliation data', async () => {
    const db = new FakeD1();
    db.orders = [
      baseOrder({ id: 'org-a-order', organization_id: 'org-a' }),
      baseOrder({ id: 'org-b-order', organization_id: 'org-b', order_number: 'private' }),
    ];
    db.cases = [
      { id: 'case-a', organization_id: 'org-a', registration_order_no: '12345', net_weight_kg: 100, gross_weight_kg: 110 },
      { id: 'case-b', organization_id: 'org-b', registration_order_no: 'private', net_weight_kg: 999, gross_weight_kg: 1000 },
    ];
    const url = new URL('https://staging.example/api/registration-orders?search=12345&limit=20&offset=0');
    const response = await handleRegistrationOrdersApi(makeRequest('GET', url.pathname + url.search), db, url, profile);
    const body = await response.json() as { items: Row[]; cases: Row[]; reconciliation: Row[]; total: number };
    expect(response.status).toBe(200);
    expect(body.items.map(row => row.id)).toEqual(['org-a-order']);
    expect(body.cases.map(row => row.id)).toEqual(['case-a']);
    expect(body.reconciliation[0]).toMatchObject({
      registration_order_id: 'org-a-order',
      order_number: '12345',
      registered_net_weight_kg: 1000,
      shipped_net_weight_kg: 500,
      registered_gross_weight_kg: 1100,
      shipped_gross_weight_kg: 550,
      registered_value_amount: 500,
      shipped_value_amount: 250,
      currency: 'USD',
      total_allocated_net_weight_kg: 500,
      total_allocated_gross_weight_kg: 550,
      total_allocated_value_amount: 250,
    });
    expect(body.reconciliation).toHaveLength(1);
    expect(db.queries.some(query => query.sql.includes('ro.organization_id = ?') && query.values[0] === 'org-a')).toBe(true);
    expect(body.total).toBe(1);
  });

  it('does not reveal an order from another organization', async () => {
    const db = new FakeD1();
    db.orders = [baseOrder({ id: 'private', organization_id: 'org-b' })];
    const url = new URL('https://staging.example/api/registration-orders/private');
    const response = await handleRegistrationOrdersApi(makeRequest('GET', url.pathname), db, url, profile);
    expect(response.status).toBe(404);
  });

  it('blocks cross-origin writes before any database operation', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/registration-orders');
    const response = await handleRegistrationOrdersApi(
      makeRequest('POST', url.pathname, orderInput(), 'https://attacker.example'), db, url, profile,
    );
    expect(response.status).toBe(403);
    expect(db.orders).toHaveLength(0);
  });

  it('creates the master registration order, preserves bank fields and records an audit event', async () => {
    const db = new FakeD1();
    const url = new URL('https://staging.example/api/registration-orders');
    const response = await handleRegistrationOrdersApi(
      makeRequest('POST', url.pathname, orderInput()), db, url, profile,
    );
    const body = await response.json() as { order: Row };
    expect(response.status).toBe(201);
    expect(db.orders).toHaveLength(1);
    expect(db.orders[0].organization_id).toBe('org-a');
    expect(db.orders[0].bank_name).toBe('Bank A');
    expect(db.orders[0].payment_instrument_code).toBe('LC-2');
    expect(db.audit).toHaveLength(1);
    expect(db.audit[0].entity_type).toBe('registration_order');
    expect(body.order.id).toBe(db.orders[0].id);
  });

  it('rejects duplicate registration-order numbers within the same organization', async () => {
    const db = new FakeD1();
    db.orders = [baseOrder({ order_number: '98765' })];
    const url = new URL('https://staging.example/api/registration-orders');
    const response = await handleRegistrationOrdersApi(
      makeRequest('POST', url.pathname, orderInput()), db, url, profile,
    );
    expect(response.status).toBe(409);
    expect(db.orders).toHaveLength(1);
    expect(db.audit).toHaveLength(0);
  });

  it('rejects reducing parent capacity below internal shipments and outside allocations', async () => {
    const db = new FakeD1();
    db.orders = [baseOrder({
      shipped_net_weight_kg: 700, total_allocated_net_weight_kg: 850,
      external_allocated_net_weight_kg: 150,
    })];
    const url = new URL('https://staging.example/api/registration-orders/order-a');
    const response = await handleRegistrationOrdersApi(
      makeRequest('PATCH', url.pathname, orderInput({ net_weight_kg: 800 })), db, url, profile,
    );
    expect(response.status).toBe(409);
    expect(db.orders[0].net_weight_kg).toBe(1000);
    expect(db.audit).toHaveLength(0);
  });

  it('requires exact net/gross/value reconciliation before finalizing', async () => {
    const db = new FakeD1();
    db.orders = [baseOrder({ total_allocation_count: 2, total_allocated_net_weight_kg: 999 })];
    const url = new URL('https://staging.example/api/registration-orders/order-a');
    const response = await handleRegistrationOrdersApi(
      makeRequest('PATCH', url.pathname, { isClosed: true }), db, url, profile,
    );
    expect(response.status).toBe(409);
    expect(db.orders[0].is_closed).toBe(0);
    expect(db.audit).toHaveLength(0);
  });

  it('finalizes a fully reconciled order and records the state-change audit', async () => {
    const db = new FakeD1();
    db.orders = [baseOrder({
      total_allocation_count: 2,
      total_allocated_net_weight_kg: 1000,
      total_allocated_gross_weight_kg: 1100,
      total_allocated_value_amount: 500,
    })];
    const url = new URL('https://staging.example/api/registration-orders/order-a');
    const response = await handleRegistrationOrdersApi(
      makeRequest('PATCH', url.pathname, { isClosed: true }), db, url, profile,
    );
    expect(response.status).toBe(200);
    expect(db.orders[0].is_closed).toBe(1);
    expect(db.orders[0].status).toBe('used');
    expect(db.audit.some(entry => entry.action === 'update')).toBe(true);
  });

  it('rejects an outside allocation that exceeds remaining capacity', async () => {
    const db = new FakeD1();
    db.orders = [baseOrder({
      shipped_net_weight_kg: 800, shipped_gross_weight_kg: 880, shipped_value_amount: 400,
      total_allocated_net_weight_kg: 800, total_allocated_gross_weight_kg: 880,
      total_allocated_value_amount: 400,
    })];
    const url = new URL('https://staging.example/api/registration-orders/order-a/external-allocations');
    const response = await handleRegistrationOrdersApi(
      makeRequest('POST', url.pathname, allocationInput({ net_weight_kg: 300 })), db, url, profile,
    );
    expect(response.status).toBe(409);
    expect(db.allocations).toHaveLength(0);
  });

  it('creates a valid outside allocation and records it in the same tenant as the master order', async () => {
    const db = new FakeD1();
    db.orders = [baseOrder({
      shipped_net_weight_kg: 500, shipped_gross_weight_kg: 550, shipped_value_amount: 250,
      total_allocated_net_weight_kg: 500, total_allocated_gross_weight_kg: 550,
      total_allocated_value_amount: 250,
    })];
    const url = new URL('https://staging.example/api/registration-orders/order-a/external-allocations');
    const response = await handleRegistrationOrdersApi(
      makeRequest('POST', url.pathname, allocationInput()), db, url, profile,
    );
    const body = await response.json() as { allocation: Row };
    expect(response.status).toBe(201);
    expect(db.allocations).toHaveLength(1);
    expect(db.allocations[0].organization_id).toBe('org-a');
    expect(body.allocation.registration_order_id).toBe('order-a');
    expect(db.audit.some(entry => entry.entity_type === 'registration_order_external_allocation')).toBe(true);
  });
});
