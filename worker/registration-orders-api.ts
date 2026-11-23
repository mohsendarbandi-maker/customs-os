export interface RegistrationOrderD1Statement {
  bind(...values: unknown[]): RegistrationOrderD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface RegistrationOrderD1Database {
  prepare(sql: string): RegistrationOrderD1Statement;
  batch(statements: RegistrationOrderD1Statement[]): Promise<unknown[]>;
}
export interface RegistrationOrdersProfile {
  id: string;
  organization_id: string;
  role: string;
  is_active: boolean;
}
interface OrderInput {
  client_id: string; order_number: string; order_date: string | null;
  status: 'pending' | 'received' | 'verified' | 'used' | 'cancelled';
  tariff_code: string | null; quantity: number | null; quantity_unit: string | null;
  net_weight_kg: number | null; gross_weight_kg: number | null;
  value_amount: number | null; currency: string | null;
  bank_name: string | null; bank_branch: string | null; bank_branch_code: string | null;
  payment_instrument_code: string | null; notes: string | null;
}
interface AllocationInput {
  recipient_company: string | null; destination_customs: string | null;
  allocation_reference: string | null;
  status: 'allocated' | 'dispatched' | 'completed' | 'cancelled';
  net_weight_kg: number; gross_weight_kg: number | null;
  value_amount: number; currency: string; notes: string | null;
}
interface OrderRow extends Record<string, unknown> {
  id: string; organization_id: string; case_id: string | null; client_id: string | null;
  order_number: string; order_date: string | null; status: string;
  tariff_code: string | null; quantity: number | null; quantity_unit: string | null;
  value_amount: number | null; currency: string | null; notes: string | null;
  net_weight_kg: number | null; gross_weight_kg: number | null;
  bank_name: string | null; bank_branch: string | null; bank_branch_code: string | null;
  payment_instrument_code: string | null; is_closed: number; closed_at: string | null;
  client_name: string | null; shipment_count: number;
  shipped_net_weight_kg: number; shipped_gross_weight_kg: number; shipped_value_amount: number;
  shipments_missing_invoice_value: number; shipments_with_currency_mismatch: number;
  external_allocation_count: number; external_allocated_net_weight_kg: number;
  external_allocated_gross_weight_kg: number; external_allocated_value_amount: number;
  external_allocations_missing_value: number; external_allocations_currency_mismatch: number;
  total_allocated_net_weight_kg: number; total_allocated_gross_weight_kg: number;
  total_allocated_value_amount: number; total_allocation_count: number;
}
interface ExternalAllocationRow extends Record<string, unknown> {
  id: string; organization_id: string; registration_order_id: string;
  recipient_company: string | null; destination_customs: string | null;
  allocation_reference: string | null; status: string; net_weight_kg: number;
  gross_weight_kg: number | null; value_amount: number; currency: string;
  notes: string | null; created_at: string; updated_at: string;
}
const COLLECTION = '/api/registration-orders';
const BODY_LIMIT = 24 * 1024;
const READ_ROLES = new Set(['owner', 'admin', 'broker', 'accountant', 'warehouse']);
const WRITE_ROLES = new Set(['owner', 'admin', 'broker']);
const ORDER_STATUSES = new Set(['pending', 'received', 'verified', 'used', 'cancelled']);
const ALLOCATION_STATUSES = new Set(['allocated', 'dispatched', 'completed', 'cancelled']);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  },
});
const fail = (code: string, status: number, details: Record<string, unknown> = {}) =>
  json({ ok: false, error: code, ...details }, status);
const normalizeDigits = (value: string) => Array.from(value.normalize('NFKC'), (ch) => {
  const n = ch.codePointAt(0) ?? 0;
  if (n >= 0x06f0 && n <= 0x06f9) return String(n - 0x06f0);
  if (n >= 0x0660 && n <= 0x0669) return String(n - 0x0660);
  return ch;
}).join('');
const parseNumber = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const raw = normalizeDigits(String(value)).replace(/[٬,\s]/g, '').trim();
  if (!raw) return null;
  const result = Number(raw);
  return Number.isFinite(result) && Number.isSafeInteger(Math.round(result * 100)) ? result : null;
};
const parseInteger = (value: unknown): number | null => {
  const result = parseNumber(value);
  return result == null || !Number.isSafeInteger(result) ? null : result;
};
const parseWeight = (value: unknown): number | null => {
  const result = parseNumber(value);
  return result == null || !Number.isSafeInteger(Math.round(result * 1000)) ? null : result;
};
const parseText = (value: unknown, max: number, nullable = true): string | null => {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) return nullable ? null : '';
  return result.length <= max ? result : null;
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const readJson = async (request: Request): Promise<Record<string, unknown> | Response> => {
  if (Number(request.headers.get('content-length') || 0) > BODY_LIMIT) return fail('REQUEST_TOO_LARGE', 413);
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > BODY_LIMIT) return fail('REQUEST_TOO_LARGE', 413);
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : fail('INVALID_JSON', 400);
  } catch {
    return fail('INVALID_JSON', 400);
  }
};
const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
};
const parseOrderInput = (raw: Record<string, unknown>): OrderInput | null => {
  const clientId = parseText(raw.client_id, 128, false);
  const orderNumber = parseText(raw.order_number, 100, false);
  const status = parseText(raw.status ?? 'received', 30, false);
  const orderDate = parseText(raw.order_date, 32);
  const tariffCode = parseText(raw.tariff_code, 80);
  const quantityUnit = parseText(raw.quantity_unit, 40);
  const notes = parseText(raw.notes, 10000);
  const quantity = raw.quantity == null || raw.quantity === '' ? null : parseInteger(raw.quantity);
  const netWeight = raw.net_weight_kg == null || raw.net_weight_kg === '' ? null : parseWeight(raw.net_weight_kg);
  const grossWeight = raw.gross_weight_kg == null || raw.gross_weight_kg === '' ? null : parseWeight(raw.gross_weight_kg);
  const valueAmount = raw.value_amount == null || raw.value_amount === '' ? null : parseNumber(raw.value_amount);
  const currencyText = parseText(raw.currency, 3);
  const currency = currencyText ? currencyText.toUpperCase() : null;
  const bankName = parseText(raw.bank_name, 200);
  const bankBranch = parseText(raw.bank_branch, 200);
  const bankBranchCode = parseText(raw.bank_branch_code, 80);
  const paymentCode = parseText(raw.payment_instrument_code, 120);
  if (
    !clientId || !orderNumber || !status || !ORDER_STATUSES.has(status) ||
    (raw.quantity != null && raw.quantity !== '' && quantity == null) ||
    (raw.net_weight_kg != null && raw.net_weight_kg !== '' && netWeight == null) ||
    (raw.gross_weight_kg != null && raw.gross_weight_kg !== '' && grossWeight == null) ||
    (raw.value_amount != null && raw.value_amount !== '' && valueAmount == null) ||
    (raw.order_date != null && orderDate == null) ||
    (raw.tariff_code != null && tariffCode == null) ||
    (raw.quantity_unit != null && quantityUnit == null) ||
    (raw.notes != null && notes == null) ||
    (raw.bank_name != null && bankName == null) ||
    (raw.bank_branch != null && bankBranch == null) ||
    (raw.bank_branch_code != null && bankBranchCode == null) ||
    (raw.payment_instrument_code != null && paymentCode == null) ||
    (valueAmount !== null && (!currency || !/^[A-Z]{3}$/.test(currency))) ||
    (currency !== null && !/^[A-Z]{3}$/.test(currency)) ||
    (quantity !== null && quantity < 0) ||
    (netWeight !== null && netWeight < 0) ||
    (grossWeight !== null && grossWeight < 0) ||
    (valueAmount !== null && valueAmount < 0) ||
    (netWeight !== null && grossWeight !== null && grossWeight < netWeight)
  ) return null;
  return {
    client_id: clientId, order_number: normalizeDigits(orderNumber), order_date: orderDate,
    status: status as OrderInput['status'], tariff_code: tariffCode, quantity, quantity_unit: quantityUnit,
    net_weight_kg: netWeight, gross_weight_kg: grossWeight, value_amount: valueAmount,
    currency: valueAmount === null ? null : currency, bank_name: bankName, bank_branch: bankBranch,
    bank_branch_code: bankBranchCode, payment_instrument_code: paymentCode, notes,
  };
};
const parseAllocationInput = (raw: Record<string, unknown>): AllocationInput | null => {
  const recipient = parseText(raw.recipient_company, 200);
  const destination = parseText(raw.destination_customs, 200);
  const reference = parseText(raw.allocation_reference, 120);
  const notes = parseText(raw.notes, 5000);
  const netWeight = parseWeight(raw.net_weight_kg);
  const grossWeight = raw.gross_weight_kg == null || raw.gross_weight_kg === '' ? null : parseWeight(raw.gross_weight_kg);
  const valueAmount = parseNumber(raw.value_amount);
  const currencyText = parseText(raw.currency, 3, false);
  const status = parseText(raw.status ?? 'allocated', 20, false);
  const currency = currencyText.toUpperCase();
  if (
    (!recipient && !destination) ||
    (raw.recipient_company != null && recipient == null) ||
    (raw.destination_customs != null && destination == null) ||
    (raw.allocation_reference != null && reference == null) ||
    (raw.notes != null && notes == null) ||
    netWeight == null || netWeight <= 0 ||
    (raw.gross_weight_kg != null && raw.gross_weight_kg !== '' && grossWeight == null) ||
    (grossWeight !== null && grossWeight < netWeight) ||
    valueAmount == null || valueAmount < 0 ||
    !/^[A-Z]{3}$/.test(currency) ||
    !status || !ALLOCATION_STATUSES.has(status)
  ) return null;
  return {
    recipient_company: recipient, destination_customs: destination, allocation_reference: reference,
    status: status as AllocationInput['status'], net_weight_kg: netWeight,
    gross_weight_kg: grossWeight, value_amount: valueAmount, currency, notes,
  };
};
const ORDER_SELECT = [
  'SELECT ro.id, ro.organization_id, ro.case_id, ro.client_id, ro.order_number, ro.order_date, ro.status,',
  'ro.tariff_code, ro.quantity, ro.quantity_unit, ro.value_amount, ro.currency, ro.notes,',
  'ro.net_weight_kg, ro.gross_weight_kg, ro.bank_name, ro.bank_branch, ro.bank_branch_code,',
  'ro.payment_instrument_code, ro.is_closed, ro.closed_at, ro.created_at, ro.updated_at, cl.name AS client_name,',
  'COALESCE(sa.shipment_count, 0) AS shipment_count, COALESCE(sa.shipped_net_weight_kg, 0) AS shipped_net_weight_kg,',
  'COALESCE(sa.shipped_gross_weight_kg, 0) AS shipped_gross_weight_kg, COALESCE(sa.shipped_value_amount, 0) AS shipped_value_amount,',
  'COALESCE(sa.shipments_missing_invoice_value, 0) AS shipments_missing_invoice_value,',
  'COALESCE(sa.shipments_with_currency_mismatch, 0) AS shipments_with_currency_mismatch,',
  'COALESCE(ea.external_allocation_count, 0) AS external_allocation_count,',
  'COALESCE(ea.external_allocated_net_weight_kg, 0) AS external_allocated_net_weight_kg,',
  'COALESCE(ea.external_allocated_gross_weight_kg, 0) AS external_allocated_gross_weight_kg,',
  'COALESCE(ea.external_allocated_value_amount, 0) AS external_allocated_value_amount,',
  'COALESCE(ea.external_allocations_missing_value, 0) AS external_allocations_missing_value,',
  'COALESCE(ea.external_allocations_currency_mismatch, 0) AS external_allocations_currency_mismatch,',
  'COALESCE(sa.shipped_net_weight_kg, 0) + COALESCE(ea.external_allocated_net_weight_kg, 0) AS total_allocated_net_weight_kg,',
  'COALESCE(sa.shipped_gross_weight_kg, 0) + COALESCE(ea.external_allocated_gross_weight_kg, 0) AS total_allocated_gross_weight_kg,',
  'COALESCE(sa.shipped_value_amount, 0) + COALESCE(ea.external_allocated_value_amount, 0) AS total_allocated_value_amount,',
  'COALESCE(sa.shipment_count, 0) + COALESCE(ea.external_allocation_count, 0) AS total_allocation_count',
  'FROM registration_orders ro',
  'LEFT JOIN clients cl ON cl.id = ro.client_id AND cl.organization_id = ro.organization_id',
  'LEFT JOIN (',
  ' SELECT ro2.id AS registration_order_id, ro2.organization_id, COUNT(s.id) AS shipment_count,',
  ' COALESCE(SUM(COALESCE(d.net_weight_kg, s.net_weight_kg)), 0) AS shipped_net_weight_kg,',
  ' COALESCE(SUM(COALESCE(d.gross_weight_kg, s.gross_weight_kg)), 0) AS shipped_gross_weight_kg,',
  ' COALESCE(SUM(d.invoice_amount), 0) AS shipped_value_amount,',
  ' COALESCE(SUM(CASE WHEN s.id IS NOT NULL AND (d.invoice_amount IS NULL OR NULLIF(TRIM(d.invoice_currency), \\'\\') IS NULL) THEN 1 ELSE 0 END), 0) AS shipments_missing_invoice_value,',
  ' COALESCE(SUM(CASE WHEN d.invoice_amount IS NOT NULL AND (ro2.currency IS NULL OR NULLIF(TRIM(d.invoice_currency), \\'\\') IS NULL OR UPPER(TRIM(d.invoice_currency)) <> UPPER(ro2.currency)) THEN 1 ELSE 0 END), 0) AS shipments_with_currency_mismatch',
  ' FROM registration_orders ro2',
  ' LEFT JOIN shipments s ON s.organization_id = ro2.organization_id AND (s.registration_order_id = ro2.id OR (s.registration_order_id IS NULL AND (s.case_id = ro2.case_id OR EXISTS (SELECT 1 FROM cases sc WHERE sc.id = s.case_id AND sc.organization_id = s.organization_id AND sc.registration_order_no = ro2.order_number))))',
  ' LEFT JOIN shipment_customs_data d ON d.shipment_id = s.id AND d.organization_id = s.organization_id',
  ' GROUP BY ro2.id, ro2.organization_id',
  ') sa ON sa.registration_order_id = ro.id AND sa.organization_id = ro.organization_id',
  'LEFT JOIN (',
  ' SELECT a.organization_id, a.registration_order_id, COUNT(*) AS external_allocation_count,',
  ' COALESCE(SUM(a.net_weight_kg), 0) AS external_allocated_net_weight_kg,',
  ' COALESCE(SUM(COALESCE(a.gross_weight_kg, 0)), 0) AS external_allocated_gross_weight_kg,',
  ' COALESCE(SUM(a.value_amount), 0) AS external_allocated_value_amount,',
  ' COALESCE(SUM(CASE WHEN a.value_amount IS NULL OR a.currency IS NULL THEN 1 ELSE 0 END), 0) AS external_allocations_missing_value,',
  ' COALESCE(SUM(CASE WHEN a.currency IS NOT NULL AND UPPER(a.currency) <> UPPER(ro3.currency) THEN 1 ELSE 0 END), 0) AS external_allocations_currency_mismatch',
  ' FROM registration_order_external_allocations a',
  ' LEFT JOIN registration_orders ro3 ON ro3.id = a.registration_order_id AND ro3.organization_id = a.organization_id',
  ' WHERE a.status <> \\'cancelled\\'',
  ' GROUP BY a.organization_id, a.registration_order_id',
  ') ea ON ea.registration_order_id = ro.id AND ea.organization_id = ro.organization_id',
].join(' ');
const integerParam = (value: string | null, fallback: number, min: number, max: number) => {
  if (value == null || !value.trim()) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
};
const route = (pathname: string) =>
  pathname === COLLECTION ? { kind: 'collection' as const } :
  !pathname.startsWith(COLLECTION + '/') ? fail('NOT_FOUND', 404) : (() => {
    try {
      const parts = pathname.slice(COLLECTION.length + 1).split('/').map(decodeURIComponent);
      if (parts.length === 1 && parts[0] && parts[0].length <= 128) return { kind: 'order' as const, orderId: parts[0] };
      if (parts.length === 2 && parts[0] && parts[1] === 'external-allocations') return { kind: 'allocations' as const, orderId: parts[0] };
      if (parts.length === 3 && parts[0] && parts[1] === 'external-allocations' && parts[2]) {
        return { kind: 'allocation' as const, orderId: parts[0], allocationId: parts[2] };
      }
    } catch { return fail('INVALID_REGISTRATION_ORDER_PATH', 400); }
    return fail('INVALID_REGISTRATION_ORDER_PATH', 400);
  })();
const readOrder = (db: RegistrationOrderD1Database, id: string, organizationId: string) =>
  db.prepare(ORDER_SELECT + ' WHERE ro.id = ? AND ro.organization_id = ? LIMIT 1')
    .bind(id, organizationId).first<OrderRow>();
const readCases = (db: RegistrationOrderD1Database, organizationId: string) =>
  db.prepare('SELECT id, registration_order_no, net_weight_kg, gross_weight_kg FROM cases WHERE organization_id = ? ORDER BY created_at DESC, id DESC')
    .bind(organizationId).all<Record<string, unknown>>();
const duplicateOrder = async (db: RegistrationOrderD1Database, organizationId: string, orderNumber: string, excludingId: string | null) => {
  const row = await db.prepare(
    'SELECT id FROM registration_orders WHERE organization_id = ? AND order_number = ? AND (? IS NULL OR id <> ?) LIMIT 1',
  ).bind(organizationId, orderNumber, excludingId, excludingId).first<{ id: string }>();
  return Boolean(row);
};
const shipmentCurrencyMismatchCount = async (
  db: RegistrationOrderD1Database, orderId: string, organizationId: string, currency: string | null,
) => {
  if (!currency) return 0;
  const row = await db.prepare(
    'SELECT COUNT(s.id) AS total FROM registration_orders ro ' +
    'JOIN shipments s ON s.organization_id = ro.organization_id AND (s.registration_order_id = ro.id OR (s.registration_order_id IS NULL AND (s.case_id = ro.case_id OR EXISTS (SELECT 1 FROM cases c WHERE c.id = s.case_id AND c.organization_id = s.organization_id AND c.registration_order_no = ro.order_number)))) ' +
    'LEFT JOIN shipment_customs_data d ON d.shipment_id = s.id AND d.organization_id = s.organization_id ' +
    'WHERE ro.id = ? AND ro.organization_id = ? AND d.invoice_amount IS NOT NULL AND (d.invoice_currency IS NULL OR UPPER(TRIM(d.invoice_currency)) <> ?)',
  ).bind(orderId, organizationId, currency).first<{ total: number }>();
  return Number(row?.total || 0);
};
const validateOrderCapacity = async (
  db: RegistrationOrderD1Database, input: OrderInput, before: OrderRow | null, orderId: string | null, organizationId: string,
) => {
  const shippedNet = Number(before?.shipped_net_weight_kg || 0);
  const shippedGross = Number(before?.shipped_gross_weight_kg || 0);
  const shippedValue = Number(before?.shipped_value_amount || 0);
  const externalNet = Number(before?.external_allocated_net_weight_kg || 0);
  const externalGross = Number(before?.external_allocated_gross_weight_kg || 0);
  const externalValue = Number(before?.external_allocated_value_amount || 0);
  const totalNet = shippedNet + externalNet;
  const totalGross = shippedGross + externalGross;
  const totalValue = shippedValue + externalValue;
  if (orderId) {
    if (input.net_weight_kg == null && totalNet > 0) return 'ORDER_NET_CAPACITY_CANNOT_BE_CLEARED';
    if (input.gross_weight_kg == null && totalGross > 0) return 'ORDER_GROSS_CAPACITY_CANNOT_BE_CLEARED';
    if (input.value_amount == null && totalValue > 0) return 'ORDER_VALUE_CAPACITY_CANNOT_BE_CLEARED';
    if (input.currency == null && totalValue > 0) return 'ORDER_CURRENCY_CANNOT_BE_CLEARED';
    if (input.net_weight_kg != null && totalNet > input.net_weight_kg + 0.001) return 'ORDER_NET_WEIGHT_BELOW_ALLOCATED';
    if (input.gross_weight_kg != null && totalGross > input.gross_weight_kg + 0.001) return 'ORDER_GROSS_WEIGHT_BELOW_ALLOCATED';
    if (input.value_amount != null && totalValue > input.value_amount + 0.01) return 'ORDER_VALUE_BELOW_ALLOCATED';
    if (input.currency && await shipmentCurrencyMismatchCount(db, orderId, organizationId, input.currency) > 0) {
      return 'ORDER_CURRENCY_CONFLICTS_WITH_SHIPMENTS';
    }
    if (input.currency) {
      const externalCurrency = await db.prepare(
        'SELECT COUNT(*) AS total FROM registration_order_external_allocations WHERE registration_order_id = ? AND organization_id = ? AND status <> \\'cancelled\\' AND UPPER(currency) <> ?',
      ).bind(orderId, organizationId, input.currency).first<{ total: number }>();
      if (Number(externalCurrency?.total || 0) > 0) return 'ORDER_CURRENCY_CONFLICTS_WITH_EXTERNAL_ALLOCATIONS';
    }
    const invalidClient = await db.prepare(
      'SELECT COUNT(s.id) AS total FROM shipments s WHERE s.organization_id = ? AND s.registration_order_id = ? AND s.client_id IS NOT ?',
    ).bind(organizationId, orderId, input.client_id).first<{ total: number }>();
    if (Number(invalidClient?.total || 0) > 0) return 'REGISTRATION_ORDER_CLIENT_CONFLICT';
  }
  return null;
};
const ensureFinalize = (order: OrderRow) => {
  if (Number(order.total_allocation_count || 0) < 1) return 'ORDER_FINALIZE_REQUIRES_ALLOCATION';
  if (order.net_weight_kg == null || Math.abs(Number(order.total_allocated_net_weight_kg || 0) - Number(order.net_weight_kg)) > 0.001) return 'ORDER_FINALIZE_NET_WEIGHT_MISMATCH';
  if (order.gross_weight_kg != null && Math.abs(Number(order.total_allocated_gross_weight_kg || 0) - Number(order.gross_weight_kg)) > 0.001) return 'ORDER_FINALIZE_GROSS_WEIGHT_MISMATCH';
  if (order.value_amount == null || !order.currency) return 'ORDER_FINALIZE_VALUE_REQUIRED';
  if (Number(order.shipments_missing_invoice_value || 0) + Number(order.external_allocations_missing_value || 0) > 0) return 'ORDER_FINALIZE_MISSING_INVOICE_VALUE';
  if (Number(order.shipments_with_currency_mismatch || 0) + Number(order.external_allocations_currency_mismatch || 0) > 0) return 'ORDER_FINALIZE_CURRENCY_MISMATCH';
  if (Math.abs(Number(order.total_allocated_value_amount || 0) - Number(order.value_amount)) > 0.01) return 'ORDER_FINALIZE_VALUE_MISMATCH';
  return null;
};
const listOrders = async (
  db: RegistrationOrderD1Database, url: URL, profile: RegistrationOrdersProfile,
): Promise<Response> => {
  const limit = integerParam(url.searchParams.get('limit'), 100, 1, 100);
  const offset = integerParam(url.searchParams.get('offset'), 0, 0, 1000000);
  const search = normalizeDigits((url.searchParams.get('search') || '').trim()).slice(0, 100);
  const where = search
    ? 'ro.organization_id = ? AND (ro.order_number LIKE ? OR cl.name LIKE ? OR ro.tariff_code LIKE ?)'
    : 'ro.organization_id = ?';
  const binds: unknown[] = search ? [profile.organization_id, '%' + search + '%', '%' + search + '%', '%' + search + '%'] : [profile.organization_id];
  try {
    const count = await db.prepare(
      'SELECT COUNT(*) AS total FROM registration_orders ro LEFT JOIN clients cl ON cl.id = ro.client_id AND cl.organization_id = ro.organization_id WHERE ' + where,
    ).bind(...binds).first<{ total: number }>();
    const rows = await db.prepare(
      ORDER_SELECT + ' WHERE ' + where + ' ORDER BY ro.created_at DESC, ro.id DESC LIMIT ? OFFSET ?',
    ).bind(...binds, limit, offset).all<OrderRow>();
    const cases = await readCases(db, profile.organization_id);
    const items = rows.results.map((row) => ({ ...row, is_closed: Boolean(row.is_closed) }));
    return json({
      ok: true, items, total: Number(count?.total || 0), limit, offset,
      cases: cases.results, reconciliation: items,
    });
  } catch {
    return fail('REGISTRATION_ORDERS_API_NOT_READY', 503);
  }
};
const createOrUpdateOrder = async (
  request: Request, db: RegistrationOrderD1Database, url: URL,
  profile: RegistrationOrdersProfile, orderId: string | null, raw: Record<string, unknown>,
): Promise<Response> => {
  const input = parseOrderInput(raw);
  if (!input) return fail('INVALID_REGISTRATION_ORDER_INPUT', 422);
  try {
    const client = await db.prepare(
      'SELECT id FROM clients WHERE id = ? AND organization_id = ? LIMIT 1',
    ).bind(input.client_id, profile.organization_id).first<{ id: string }>();
    if (!client) return fail('CLIENT_NOT_FOUND', 404);
    const before = orderId ? await readOrder(db, orderId, profile.organization_id) : null;
    if (orderId && !before) return fail('REGISTRATION_ORDER_NOT_FOUND', 404);
    if (await duplicateOrder(db, profile.organization_id, input.order_number, orderId)) return fail('REGISTRATION_ORDER_EXISTS', 409);
    const capacityError = await validateOrderCapacity(db, input, before, orderId, profile.organization_id);
    if (capacityError) return fail(capacityError, 409);
    const now = new Date().toISOString();
    const id = orderId || crypto.randomUUID();
    const after = {
      id, organization_id: profile.organization_id, case_id: before?.case_id ?? null,
      ...input, is_closed: false, closed_at: null, created_at: before?.created_at || now, updated_at: now,
    };
    const statement = before
      ? db.prepare(
        'UPDATE registration_orders SET client_id = ?, order_number = ?, order_date = ?, status = ?, tariff_code = ?, quantity = ?, quantity_unit = ?, value_amount = ?, currency = ?, notes = ?, net_weight_kg = ?, gross_weight_kg = ?, bank_name = ?, bank_branch = ?, bank_branch_code = ?, payment_instrument_code = ?, updated_at = ? WHERE id = ? AND organization_id = ?',
      ).bind(
        input.client_id, input.order_number, input.order_date, input.status, input.tariff_code,
        input.quantity, input.quantity_unit, input.value_amount, input.currency, input.notes,
        input.net_weight_kg, input.gross_weight_kg, input.bank_name, input.bank_branch,
        input.bank_branch_code, input.payment_instrument_code, now, id, profile.organization_id,
      )
      : db.prepare(
        'INSERT INTO registration_orders (id, organization_id, case_id, order_number, order_date, status, tariff_code, quantity, quantity_unit, value_amount, currency, notes, created_at, updated_at, client_id, net_weight_kg, gross_weight_kg, bank_name, bank_branch, bank_branch_code, payment_instrument_code, is_closed, closed_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)',
      ).bind(
        id, profile.organization_id, input.order_number, input.order_date, input.status, input.tariff_code,
        input.quantity, input.quantity_unit, input.value_amount, input.currency, input.notes, now, now,
        input.client_id, input.net_weight_kg, input.gross_weight_kg, input.bank_name, input.bank_branch,
        input.bank_branch_code, input.payment_instrument_code,
      );
    await db.batch([
      statement,
      audit(db, request, profile, before ? 'update' : 'create', 'registration_order', id, before, after, now),
    ]);
    const saved = await readOrder(db, id, profile.organization_id);
    return saved ? json({ ok: true, order: { ...saved, is_closed: Boolean(saved.is_closed) } }, before ? 200 : 201)
      : fail('REGISTRATION_ORDER_SAVE_NOT_CONFIRMED', 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE constraint failed.*registration_orders/i.test(message)) return fail('REGISTRATION_ORDER_EXISTS', 409);
    if (/REGISTRATION_ORDER|ORDER_CAPACITY/i.test(message)) return fail('REGISTRATION_ORDER_CONSTRAINT_FAILED', 409);
    return fail(orderId ? 'REGISTRATION_ORDER_UPDATE_FAILED' : 'REGISTRATION_ORDER_CREATE_FAILED', 500);
  }
};
const closeOrder = async (
  request: Request, db: RegistrationOrderD1Database, url: URL,
  profile: RegistrationOrdersProfile, orderId: string, isClosed: boolean,
): Promise<Response> => {
  try {
    const before = await readOrder(db, orderId, profile.organization_id);
    if (!before) return fail('REGISTRATION_ORDER_NOT_FOUND', 404);
    if (isClosed) {
      const invalid = ensureFinalize(before);
      if (invalid) return fail(invalid, 409);
    }
    const now = new Date().toISOString();
    const closedAt = isClosed ? (before.closed_at || now) : null;
    const status = isClosed ? 'used' : before.status;
    const after = { ...before, is_closed: isClosed ? 1 : 0, closed_at: closedAt, status, updated_at: now };
    await db.batch([
      db.prepare(
        'UPDATE registration_orders SET is_closed = ?, closed_at = ?, status = ?, updated_at = ? WHERE id = ? AND organization_id = ?',
      ).bind(isClosed ? 1 : 0, closedAt, status, now, orderId, profile.organization_id),
      audit(db, request, profile, 'update', 'registration_order', orderId, before, after, now),
    ]);
    const saved = await readOrder(db, orderId, profile.organization_id);
    return saved ? json({ ok: true, order: { ...saved, is_closed: Boolean(saved.is_closed) } }) : fail('REGISTRATION_ORDER_NOT_FOUND', 404);
  } catch {
    return fail('REGISTRATION_ORDER_STATE_UPDATE_FAILED', 500);
  }
};
const readAllocation = (db: RegistrationOrderD1Database, orderId: string, allocationId: string, organizationId: string) =>
  db.prepare(
    'SELECT id, organization_id, registration_order_id, recipient_company, destination_customs, allocation_reference, status, net_weight_kg, gross_weight_kg, value_amount, currency, notes, created_at, updated_at FROM registration_order_external_allocations WHERE id = ? AND registration_order_id = ? AND organization_id = ? LIMIT 1',
  ).bind(allocationId, orderId, organizationId).first<ExternalAllocationRow>();
const audit = (
  db: RegistrationOrderD1Database, request: Request, profile: RegistrationOrdersProfile,
  action: 'create' | 'update', entityType: 'registration_order' | 'registration_order_external_allocation',
  entityId: string, before: unknown, after: unknown, createdAt: string,
) => db.prepare(
  'INSERT INTO customs_os_audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, request_id, created_at) ' +
  'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0',
).bind(
  crypto.randomUUID(), profile.organization_id, profile.id, action, entityType, entityId,
  before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after),
  request.headers.get('cf-ray') || crypto.randomUUID(), createdAt,
);
const listAllocations = async (db: RegistrationOrderD1Database, orderId: string, organizationId: string) => {
  const order = await readOrder(db, orderId, organizationId);
  if (!order) return fail('REGISTRATION_ORDER_NOT_FOUND', 404);
  try {
    const result = await db.prepare(
      'SELECT id, organization_id, registration_order_id, recipient_company, destination_customs, allocation_reference, status, net_weight_kg, gross_weight_kg, value_amount, currency, notes, created_at, updated_at FROM registration_order_external_allocations WHERE registration_order_id = ? AND organization_id = ? ORDER BY created_at DESC, id DESC',
    ).bind(orderId, organizationId).all<ExternalAllocationRow>();
    return json({ ok: true, items: result.results });
  } catch {
    return fail('REGISTRATION_ORDER_ALLOCATIONS_API_NOT_READY', 503);
  }
};
const validateAllocationCapacity = (
  order: OrderRow, input: AllocationInput, before: ExternalAllocationRow | null,
) => {
  if (Boolean(order.is_closed)) return 'REGISTRATION_ORDER_CLOSED';
  if (order.net_weight_kg == null || order.value_amount == null || !order.currency) return 'REGISTRATION_ORDER_CAPACITY_REQUIRED';
  if (order.gross_weight_kg != null && input.status !== 'cancelled' && input.gross_weight_kg == null) return 'REGISTRATION_ORDER_GROSS_WEIGHT_REQUIRED';
  if (Number(order.shipments_missing_invoice_value || 0) > 0) return 'REGISTRATION_ORDER_SHIPMENT_VALUE_INCOMPLETE';
  if (Number(order.shipments_with_currency_mismatch || 0) > 0) return 'REGISTRATION_ORDER_SHIPMENT_CURRENCY_MISMATCH';
  const subtractOld = Boolean(before && before.status !== 'cancelled');
  const currentNet = Number(order.total_allocated_net_weight_kg || 0) - (subtractOld ? Number(before?.net_weight_kg || 0) : 0);
  const currentGross = Number(order.total_allocated_gross_weight_kg || 0) - (subtractOld ? Number(before?.gross_weight_kg || 0) : 0);
  const currentValue = Number(order.total_allocated_value_amount || 0) - (subtractOld ? Number(before?.value_amount || 0) : 0);
  const active = input.status !== 'cancelled';
  const net = currentNet + (active ? input.net_weight_kg : 0);
  const gross = currentGross + (active ? Number(input.gross_weight_kg || 0) : 0);
  const value = currentValue + (active ? input.value_amount : 0);
  if (net > Number(order.net_weight_kg) + 0.001) return 'REGISTRATION_ORDER_NET_CAPACITY_EXCEEDED';
  if (order.gross_weight_kg != null && gross > Number(order.gross_weight_kg) + 0.001) return 'REGISTRATION_ORDER_GROSS_CAPACITY_EXCEEDED';
  if (value > Number(order.value_amount) + 0.01) return 'REGISTRATION_ORDER_VALUE_CAPACITY_EXCEEDED';
  if (active && input.currency !== order.currency) return 'REGISTRATION_ORDER_ALLOCATION_CURRENCY_MISMATCH';
  const previousMismatch = Boolean(before && before.status !== 'cancelled' && before.currency !== order.currency);
  if (Number(order.external_allocations_currency_mismatch || 0) - (previousMismatch ? 1 : 0) > 0) return 'REGISTRATION_ORDER_EXTERNAL_CURRENCY_MISMATCH';
  return null;
};
const saveAllocation = async (
  request: Request, db: RegistrationOrderD1Database, url: URL,
  profile: RegistrationOrdersProfile, orderId: string, allocationId: string | null,
): Promise<Response> => {
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const input = parseAllocationInput(raw);
  if (!input) return fail('INVALID_REGISTRATION_ORDER_ALLOCATION_INPUT', 422);
  try {
    const order = await readOrder(db, orderId, profile.organization_id);
    if (!order) return fail('REGISTRATION_ORDER_NOT_FOUND', 404);
    const before = allocationId ? await readAllocation(db, orderId, allocationId, profile.organization_id) : null;
    if (allocationId && !before) return fail('REGISTRATION_ORDER_ALLOCATION_NOT_FOUND', 404);
    if (!allocationId && input.status === 'cancelled') return fail('INVALID_NEW_ALLOCATION_STATUS', 422);
    const capacityError = validateAllocationCapacity(order, input, before);
    if (capacityError) return fail(capacityError, 409);
    const now = new Date().toISOString();
    const id = allocationId || crypto.randomUUID();
    const after = { id, organization_id: profile.organization_id, registration_order_id: orderId, ...input, created_at: before?.created_at || now, updated_at: now };
    const statement = before
      ? db.prepare(
        'UPDATE registration_order_external_allocations SET recipient_company = ?, destination_customs = ?, allocation_reference = ?, status = ?, net_weight_kg = ?, gross_weight_kg = ?, value_amount = ?, currency = ?, notes = ?, updated_at = ? WHERE id = ? AND registration_order_id = ? AND organization_id = ?',
      ).bind(
        input.recipient_company, input.destination_customs, input.allocation_reference, input.status,
        input.net_weight_kg, input.gross_weight_kg, input.value_amount, input.currency, input.notes,
        now, id, orderId, profile.organization_id,
      )
      : db.prepare(
        'INSERT INTO registration_order_external_allocations (id, organization_id, registration_order_id, recipient_company, destination_customs, allocation_reference, status, net_weight_kg, gross_weight_kg, value_amount, currency, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        id, profile.organization_id, orderId, input.recipient_company, input.destination_customs,
        input.allocation_reference, input.status, input.net_weight_kg, input.gross_weight_kg,
        input.value_amount, input.currency, input.notes, profile.id, now, now,
      );
    await db.batch([
      statement,
      audit(db, request, profile, before ? 'update' : 'create', 'registration_order_external_allocation', id, before, after, now),
    ]);
    const saved = await readAllocation(db, orderId, id, profile.organization_id);
    return saved ? json({ ok: true, allocation: saved }, before ? 200 : 201) : fail('REGISTRATION_ORDER_ALLOCATION_SAVE_NOT_CONFIRMED', 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/REGISTRATION_ORDER|ORDER_CAPACITY/i.test(message)) return fail('REGISTRATION_ORDER_ALLOCATION_CONSTRAINT_FAILED', 409);
    return fail('REGISTRATION_ORDER_ALLOCATION_SAVE_FAILED', 500);
  }
};
export const handleRegistrationOrdersApi = async (
  request: Request, db: RegistrationOrderD1Database, url: URL, profile: RegistrationOrdersProfile,
): Promise<Response> => {
  if (!profile.is_active || !READ_ROLES.has(profile.role)) return fail('FORBIDDEN', 403);
  if (!profile.id || !profile.organization_id) return fail('INVALID_SESSION_PROFILE', 401);
  const target = route(url.pathname);
  if (target instanceof Response) return target;
  if (target.kind === 'collection' && request.method === 'GET') return listOrders(db, url, profile);
  if (target.kind === 'collection' && request.method === 'POST') {
    if (!WRITE_ROLES.has(profile.role)) return fail('FORBIDDEN', 403);
    if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
    const raw = await readJson(request);
    return raw instanceof Response ? raw : createOrUpdateOrder(request, db, url, profile, null, raw);
  }
  if (target.kind === 'order' && request.method === 'GET') {
    try {
      const order = await readOrder(db, target.orderId, profile.organization_id);
      return order ? json({ ok: true, order: { ...order, is_closed: Boolean(order.is_closed) } }) : fail('REGISTRATION_ORDER_NOT_FOUND', 404);
    } catch {
      return fail('REGISTRATION_ORDERS_API_NOT_READY', 503);
    }
  }
  if (target.kind === 'order' && request.method === 'PATCH') {
    if (!WRITE_ROLES.has(profile.role)) return fail('FORBIDDEN', 403);
    if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
    const raw = await readJson(request);
    if (raw instanceof Response) return raw;
    if (typeof raw.isClosed === 'boolean') return closeOrder(request, db, url, profile, target.orderId, raw.isClosed);
    return createOrUpdateOrder(request, db, url, profile, target.orderId, raw);
  }
  if (target.kind === 'allocations' && request.method === 'GET') return listAllocations(db, target.orderId, profile.organization_id);
  if (target.kind === 'allocations' && request.method === 'POST') {
    if (!WRITE_ROLES.has(profile.role)) return fail('FORBIDDEN', 403);
    return saveAllocation(request, db, url, profile, target.orderId, null);
  }
  if (target.kind === 'allocation' && request.method === 'PATCH') {
    if (!WRITE_ROLES.has(profile.role)) return fail('FORBIDDEN', 403);
    return saveAllocation(request, db, url, profile, target.orderId, target.allocationId);
  }
  return fail('METHOD_NOT_ALLOWED', 405, { allowed: ['GET', 'POST', 'PATCH'] });
};
