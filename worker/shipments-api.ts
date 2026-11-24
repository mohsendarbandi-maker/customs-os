export interface ShipmentsD1Statement {
  bind(...values: unknown[]): ShipmentsD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface ShipmentsD1Database {
  prepare(sql: string): ShipmentsD1Statement;
  batch(statements: ShipmentsD1Statement[]): Promise<unknown[]>;
}
export interface ShipmentsProfile {
  id: string;
  organization_id: string;
  role: string;
  is_active: boolean;
}
interface ShipmentInput {
  clientId: string;
  caseId?: string | null;
  registrationOrderId?: string | null;
  shippingLine?: string | null;
  billOfLading?: string | null;
  billOfLadingYear?: number | null;
  voyageNo?: string | null;
  vesselName: string;
  vesselImo?: string | null;
  vesselFlag?: string | null;
  originPort?: string | null;
  destinationPort?: string | null;
  cargoCount: number;
  cargoCountUnit?: string | null;
  netWeightKg: number;
  grossWeightKg: number;
  currentStatus?: string | null;
  currentLocation?: string | null;
  transportDocumentsStatus?: string | null;
  releaseInvoicePaymentStatus?: string | null;
  registrationOrderNo?: string | null;
  customsRegime?: string | null;
  sataCode?: string | null;
  cargoDescription?: string | null;
}
interface ShipmentRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  case_id: string | null;
  client_id: string | null;
  client_name: string | null;
  vessel_id: string | null;
  vessel_name: string | null;
  shipping_line: string | null;
  bill_of_lading_no: string | null;
  bill_of_lading_year: number | null;
  voyage_no: string | null;
  origin_port: string | null;
  destination_port: string | null;
  cargo_count: number | null;
  cargo_count_unit: string | null;
  net_weight_kg: number | null;
  gross_weight_kg: number | null;
  current_status: string | null;
  current_location: string | null;
  display_name: string | null;
  registration_order_id: string | null;
  registration_order_no: string | null;
  customs_regime: string | null;
  sata_code: string | null;
  transport_documents_status: string | null;
  release_invoice_payment_status: string | null;
  created_at: string;
}
const COLLECTION = '/api/shipments';
const ALLOWED_ROLES = new Set(['owner', 'admin', 'broker', 'warehouse']);
const STATUSES = new Set([
  'draft', 'booking_confirmed', 'loading', 'loaded', 'departed', 'in_transit',
  'approaching_destination', 'anchorage', 'berthing', 'discharging', 'discharged',
  'completed', 'delayed', 'cancelled',
]);
const TRANSPORT_DOCUMENT_STATUSES = new Set(['not_ready', 'ready']);
const RELEASE_PAYMENT_STATUSES = new Set(['unpaid', 'paid']);
const SELECT_SQL =
  'SELECT s.id,s.organization_id,s.case_id,s.registration_order_id,' +
  'COALESCE(s.client_id,c.client_id) AS client_id,cl.name AS client_name,' +
  's.vessel_id,v.name AS vessel_name,s.shipping_line,s.bill_of_lading_no,' +
  's.bill_of_lading_year,s.voyage_no,s.origin_port,s.destination_port,' +
  's.cargo_count,s.cargo_count_unit,s.net_weight_kg,s.gross_weight_kg,' +
  's.current_status,s.current_location,s.display_name,s.transport_documents_status,' +
  's.release_invoice_payment_status,s.created_at,sc.registration_order_no,' +
  'sc.customs_regime,sc.sata_code,sc.cargo_description ' +
  'FROM shipments s ' +
  'LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id ' +
  'LEFT JOIN clients cl ON cl.id=COALESCE(s.client_id,c.client_id) AND cl.organization_id=s.organization_id ' +
  'LEFT JOIN vessels v ON v.id=s.vessel_id AND v.organization_id=s.organization_id ' +
  'LEFT JOIN shipment_customs_data sc ON sc.shipment_id=s.id AND sc.organization_id=s.organization_id';
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
const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) &&
    request.headers.get('sec-fetch-site') !== 'cross-site';
};
const boundedInteger = (value: string | null, fallback: number, min: number, max: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
const clean = (value: unknown, max = 255): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
};
const numeric = (value: unknown, name: string, allowZero = true): number | Response => {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    return fail('INVALID_' + name.toUpperCase(), 400);
  }
  return value;
};
const parseInput = async (request: Request): Promise<ShipmentInput | Response> => {
  let raw: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('INVALID_REQUEST', 400);
    raw = parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_REQUEST', 400);
  }
  const clientId = clean(raw.clientId, 128);
  const vesselName = clean(raw.vesselName, 160);
  const cargoCount = numeric(raw.cargoCount, 'CARGO_COUNT');
  const netWeightKg = numeric(raw.netWeightKg, 'NET_WEIGHT_KG', false);
  const grossWeightKg = numeric(raw.grossWeightKg, 'GROSS_WEIGHT_KG', false);
  if (!clientId) return fail('CLIENT_REQUIRED', 400);
  if (!vesselName) return fail('VESSEL_REQUIRED', 400);
  if (cargoCount instanceof Response) return cargoCount;
  if (!Number.isSafeInteger(cargoCount) || cargoCount <= 0) return fail('INVALID_CARGO_COUNT', 400);
  if (netWeightKg instanceof Response) return netWeightKg;
  if (grossWeightKg instanceof Response) return grossWeightKg;
  if (grossWeightKg < netWeightKg) return fail('GROSS_WEIGHT_BELOW_NET_WEIGHT', 400);
  const yearValue = raw.billOfLadingYear == null || raw.billOfLadingYear === '' ? null : Number(raw.billOfLadingYear);
  if (yearValue !== null && (!Number.isSafeInteger(yearValue) || yearValue < 1900 || yearValue > 2200)) {
    return fail('INVALID_BILL_OF_LADING_YEAR', 400);
  }
  const imo = clean(raw.vesselImo, 16);
  if (imo && !/^\d{7}$/.test(imo)) return fail('INVALID_IMO', 400);
  const status = clean(raw.currentStatus, 40) || 'draft';
  const transportStatus = clean(raw.transportDocumentsStatus, 40) || 'not_ready';
  const releaseStatus = clean(raw.releaseInvoicePaymentStatus, 40) || 'unpaid';
  if (!STATUSES.has(status)) return fail('INVALID_SHIPMENT_STATUS', 400);
  if (!TRANSPORT_DOCUMENT_STATUSES.has(transportStatus)) return fail('INVALID_TRANSPORT_DOCUMENT_STATUS', 400);
  if (!RELEASE_PAYMENT_STATUSES.has(releaseStatus)) return fail('INVALID_RELEASE_PAYMENT_STATUS', 400);
  return {
    clientId,
    caseId: clean(raw.caseId, 128),
    registrationOrderId: clean(raw.registrationOrderId, 128),
    shippingLine: clean(raw.shippingLine, 160),
    billOfLading: clean(raw.billOfLading, 100),
    billOfLadingYear: yearValue,
    voyageNo: clean(raw.voyageNo, 100),
    vesselName,
    vesselImo: imo,
    vesselFlag: clean(raw.vesselFlag, 8)?.toUpperCase() || null,
    originPort: clean(raw.originPort, 100),
    destinationPort: clean(raw.destinationPort, 100),
    cargoCount,
    cargoCountUnit: clean(raw.cargoCountUnit, 40) || 'رول',
    netWeightKg,
    grossWeightKg,
    currentStatus: status,
    currentLocation: clean(raw.currentLocation, 160),
    transportDocumentsStatus: transportStatus,
    releaseInvoicePaymentStatus: releaseStatus,
    registrationOrderNo: clean(raw.registrationOrderNo, 100),
    customsRegime: clean(raw.customsRegime, 50),
    sataCode: clean(raw.sataCode, 100),
    cargoDescription: clean(raw.cargoDescription, 1000),
  };
};
const routeId = (pathname: string): string | null | Response => {
  if (pathname === COLLECTION) return null;
  if (!pathname.startsWith(COLLECTION + '/')) return fail('NOT_FOUND', 404);
  const value = pathname.slice(COLLECTION.length + 1);
  if (!value || value.includes('/')) return fail('INVALID_SHIPMENT_ID', 400);
  try {
    const id = decodeURIComponent(value);
    return id && id.length <= 128 && !id.includes('/') ? id : fail('INVALID_SHIPMENT_ID', 400);
  } catch {
    return fail('INVALID_SHIPMENT_ID', 400);
  }
};
const getShipment = (db: ShipmentsD1Database, id: string, organizationId: string) =>
  db.prepare(SELECT_SQL + ' WHERE s.id=? AND s.organization_id=? LIMIT 1')
    .bind(id, organizationId).first<ShipmentRow>();
const validateReferences = async (
  db: ShipmentsD1Database,
  input: ShipmentInput,
  organizationId: string,
  excludedShipmentId = '',
) => {
  const client = await db.prepare(
    'SELECT id FROM clients WHERE id=? AND organization_id=? LIMIT 1',
  ).bind(input.clientId, organizationId).first<{ id: string }>();
  if (!client) return fail('CLIENT_NOT_FOUND', 404);
  let order: { id: string; order_number: string; client_id: string | null; case_id: string | null; is_closed: number | null } | null = null;
  if (input.registrationOrderId) {
    order = await db.prepare(
      'SELECT id,order_number,client_id,case_id,is_closed FROM registration_orders WHERE id=? AND organization_id=? LIMIT 1',
    ).bind(input.registrationOrderId, organizationId).first<typeof order>();
    if (!order) return fail('REGISTRATION_ORDER_NOT_FOUND', 404);
    if (order.is_closed) return fail('REGISTRATION_ORDER_CLOSED', 409);
    if (order.client_id && order.client_id !== input.clientId) return fail('REGISTRATION_ORDER_CLIENT_MISMATCH', 409);
  }
  let caseId = input.caseId || order?.case_id || null;
  if (caseId) {
    const linkedCase = await db.prepare(
      'SELECT id,client_id FROM cases WHERE id=? AND organization_id=? LIMIT 1',
    ).bind(caseId, organizationId).first<{ id: string; client_id: string | null }>();
    if (!linkedCase) return fail('CASE_NOT_FOUND', 404);
    if (linkedCase.client_id && linkedCase.client_id !== input.clientId) return fail('CASE_CLIENT_MISMATCH', 409);
  }
  if (input.billOfLading && input.shippingLine && input.billOfLadingYear !== null) {
    const duplicate = await db.prepare(
      'SELECT id FROM shipments WHERE organization_id=? AND lower(trim(coalesce(shipping_line,\'\')))=lower(trim(?)) ' +
      'AND lower(trim(coalesce(bill_of_lading_no,\'\')))=lower(trim(?)) AND bill_of_lading_year=? ' +
      'AND id<>? LIMIT 1',
    ).bind(organizationId, input.shippingLine, input.billOfLading, input.billOfLadingYear, excludedShipmentId).first<{ id: string }>();
    if (duplicate) return fail('DUPLICATE_BILL_OF_LADING', 409, { shipmentId: duplicate.id });
  }
  return { order, caseId };
};
const resolveVessel = async (
  db: ShipmentsD1Database,
  input: ShipmentInput,
  organizationId: string,
): Promise<{ id: string; insert: ShipmentsD1Statement | null } | Response> => {
  const existing = await db.prepare(
    'SELECT id FROM vessels WHERE organization_id=? AND lower(trim(name))=lower(trim(?)) ORDER BY id LIMIT 1',
  ).bind(organizationId, input.vesselName).first<{ id: string }>();
  if (existing) return { id: existing.id, insert: null };
  const line = input.shippingLine ? await db.prepare(
    'SELECT id FROM shipping_lines WHERE organization_id=? AND (lower(trim(name))=lower(trim(?)) OR lower(trim(coalesce(name_fa,\'\')))=lower(trim(?))) LIMIT 1',
  ).bind(organizationId, input.shippingLine, input.shippingLine).first<{ id: string }>() : null;
  const id = crypto.randomUUID();
  const insert = db.prepare(
    'INSERT INTO vessels (id,organization_id,name,imo_number,flag_code,shipping_line_id,created_at) VALUES (?,?,?,?,?,?,?)',
  ).bind(id, organizationId, input.vesselName, input.vesselImo, input.vesselFlag, line?.id || null, new Date().toISOString());
  return { id, insert };
};
const displayName = (input: ShipmentInput, clientName: string) =>
  [input.cargoCount.toLocaleString('en-US'), input.cargoCountUnit || 'کالا', clientName, input.vesselName]
    .filter(Boolean).join(' · ').slice(0, 240);
const customsDataUpsert = (
  db: ShipmentsD1Database,
  shipmentId: string,
  organizationId: string,
  input: ShipmentInput,
  actorId: string,
  now: string,
) => db.prepare(
  'INSERT INTO shipment_customs_data ' +
  '(shipment_id,organization_id,registration_order_no,package_count,cargo_description,net_weight_kg,gross_weight_kg,sata_code,customs_regime,created_by,created_at,updated_at) ' +
  'VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ' +
  'ON CONFLICT(shipment_id) DO UPDATE SET ' +
  'registration_order_no=excluded.registration_order_no,package_count=excluded.package_count,' +
  'cargo_description=excluded.cargo_description,net_weight_kg=excluded.net_weight_kg,' +
  'gross_weight_kg=excluded.gross_weight_kg,sata_code=excluded.sata_code,' +
  'customs_regime=excluded.customs_regime,updated_at=excluded.updated_at',
).bind(
  shipmentId, organizationId, input.registrationOrderNo, input.cargoCount,
  input.cargoDescription, input.netWeightKg, input.grossWeightKg, input.sataCode,
  input.customsRegime, actorId, now, now,
);
export const handleShipmentsApi = async (
  request: Request,
  db: ShipmentsD1Database,
  url: URL,
  profile: ShipmentsProfile,
): Promise<Response> => {
  if (!profile.is_active || !ALLOWED_ROLES.has(profile.role)) return fail('FORBIDDEN', 403);
  if (!profile.id || !profile.organization_id) return fail('INVALID_SESSION_PROFILE', 401);
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  if (request.method === 'GET' && url.pathname === COLLECTION + '/registration-orders') {
    const limit = boundedInteger(url.searchParams.get('limit'), 100, 1, 100);
    const offset = boundedInteger(url.searchParams.get('offset'), 0, 0, 1000000);
    try {
      const count = await db.prepare(
        'SELECT COUNT(*) AS total FROM registration_orders WHERE organization_id=?',
      ).bind(profile.organization_id).first<{ total: number }>();
      const rows = await db.prepare(
        'SELECT id,client_id,order_number,case_id,is_closed,bank_name,bank_branch,bank_branch_code,payment_instrument_code ' +
        'FROM registration_orders WHERE organization_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',
      ).bind(profile.organization_id, limit, offset).all<{
        id: string; client_id: string | null; order_number: string; case_id: string | null;
        is_closed: number | boolean; bank_name: string | null; bank_branch: string | null;
        bank_branch_code: string | null; payment_instrument_code: string | null;
      }>();
      return json({
        ok: true,
        items: rows.results.map(order => ({ ...order, is_closed: Boolean(order.is_closed) })),
        total: Number(count?.total || 0),
        limit,
        offset,
      });
    } catch {
      return fail('SHIPMENT_OPTIONS_NOT_READY', 503);
    }
  }
  const id = routeId(url.pathname);
  if (id instanceof Response) return id;
  if (request.method === 'GET' && id === null) {
    const limit = boundedInteger(url.searchParams.get('limit'), 100, 1, 200);
    const offset = boundedInteger(url.searchParams.get('offset'), 0, 0, 1000000);
    const search = clean(url.searchParams.get('search'), 100);
    const where = search
      ? 's.organization_id=? AND (s.display_name LIKE ? OR s.bill_of_lading_no LIKE ? OR ' +
        's.shipping_line LIKE ? OR v.name LIKE ? OR cl.name LIKE ?)'
      : 's.organization_id=?';
    const bindings: unknown[] = search
      ? [profile.organization_id, ...Array.from({ length: 5 }, () => '%' + search + '%')]
      : [profile.organization_id];
    try {
      const count = await db.prepare(
        'SELECT COUNT(*) AS total FROM shipments s ' +
        'LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id ' +
        'LEFT JOIN clients cl ON cl.id=COALESCE(s.client_id,c.client_id) AND cl.organization_id=s.organization_id ' +
        'LEFT JOIN vessels v ON v.id=s.vessel_id AND v.organization_id=s.organization_id ' +
        'WHERE ' + where,
      ).bind(...bindings).first<{ total: number }>();
      const rows = await db.prepare(
        SELECT_SQL + ' WHERE ' + where + ' ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?',
      ).bind(...bindings, limit, offset).all<ShipmentRow>();
      return json({ ok: true, items: rows.results, total: Number(count?.total || 0), limit, offset });
    } catch {
      return fail('SHIPMENTS_API_NOT_READY', 503);
    }
  }
  if (request.method === 'GET' && id !== null) {
    try {
      const shipment = await getShipment(db, id, profile.organization_id);
      return shipment ? json({ ok: true, shipment }) : fail('SHIPMENT_NOT_FOUND', 404);
    } catch {
      return fail('SHIPMENTS_API_NOT_READY', 503);
    }
  }
  if (!['POST', 'PATCH'].includes(request.method)) {
    return fail('METHOD_NOT_ALLOWED', 405, { allowed: id === null ? ['GET', 'POST'] : ['GET', 'PATCH'] });
  }
  if ((request.method === 'POST' && id !== null) || (request.method === 'PATCH' && id === null)) {
    return fail('NOT_FOUND', 404);
  }
  const input = await parseInput(request);
  if (input instanceof Response) return input;
  try {
    const references = await validateReferences(db, input, profile.organization_id, id || '');
    if (references instanceof Response) return references;
    const vessel = await resolveVessel(db, input, profile.organization_id);
    if (vessel instanceof Response) return vessel;
    const client = await db.prepare(
      'SELECT name FROM clients WHERE id=? AND organization_id=? LIMIT 1',
    ).bind(input.clientId, profile.organization_id).first<{ name: string }>();
    if (!client) return fail('CLIENT_NOT_FOUND', 404);
    const now = new Date().toISOString();
    const name = displayName(input, client.name);
    if (request.method === 'POST') {
      const shipmentId = crypto.randomUUID();
      const caseId = references.caseId || crypto.randomUUID();
      const createCase = !references.caseId;
      const statements: ShipmentsD1Statement[] = [];
      if (vessel.insert) statements.push(vessel.insert);
      if (createCase) {
        statements.push(db.prepare(
          'INSERT INTO cases (id,organization_id,client_id,status,registration_order_no,cargo_count,cargo_count_unit,' +
          'cargo_description,net_weight_kg,gross_weight_kg,display_name,created_at,updated_at) ' +
          'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          caseId, profile.organization_id, input.clientId, 'draft',
          input.registrationOrderNo || references.order?.order_number || null,
          input.cargoCount, input.cargoCountUnit, input.cargoDescription,
          input.netWeightKg, input.grossWeightKg, name, now, now,
        ));
      }
      statements.push(db.prepare(
        'INSERT INTO shipments (id,organization_id,case_id,registration_order_id,client_id,vessel_id,transport_mode,' +
        'shipping_line,bill_of_lading_no,bill_of_lading_year,voyage_no,origin_port,destination_port,cargo_count,' +
        'cargo_count_unit,net_weight_kg,gross_weight_kg,current_status,current_location,display_name,' +
        'transport_documents_status,release_invoice_payment_status,ship_passed,created_at,updated_at) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        shipmentId, profile.organization_id, caseId, input.registrationOrderId, input.clientId,
        vessel.id, 'sea', input.shippingLine, input.billOfLading, input.billOfLadingYear,
        input.voyageNo, input.originPort, input.destinationPort, input.cargoCount,
        input.cargoCountUnit, input.netWeightKg, input.grossWeightKg, input.currentStatus,
        input.currentLocation, name, input.transportDocumentsStatus, input.releaseInvoicePaymentStatus,
        0, now, now,
      ));
      statements.push(customsDataUpsert(db, shipmentId, profile.organization_id, input, profile.id, now));
      await db.batch(statements);
      const saved = await getShipment(db, shipmentId, profile.organization_id);
      return saved ? json({ ok: true, shipment: saved }, 201) : fail('SHIPMENT_WRITE_NOT_CONFIRMED', 500);
    }
    const existing = await getShipment(db, id!, profile.organization_id);
    if (!existing) return fail('SHIPMENT_NOT_FOUND', 404);
    const caseId = existing.case_id;
    if (caseId) {
      const linkedCase = await db.prepare(
        'SELECT client_id FROM cases WHERE id=? AND organization_id=? LIMIT 1',
      ).bind(caseId, profile.organization_id).first<{ client_id: string | null }>();
      if (linkedCase?.client_id && linkedCase.client_id !== input.clientId) {
        return fail('CASE_CLIENT_MISMATCH', 409);
      }
    }
    const statements: ShipmentsD1Statement[] = [];
    if (vessel.insert) statements.push(vessel.insert);
    statements.push(db.prepare(
      'UPDATE shipments SET registration_order_id=?,client_id=?,vessel_id=?,shipping_line=?,bill_of_lading_no=?,' +
      'bill_of_lading_year=?,voyage_no=?,origin_port=?,destination_port=?,cargo_count=?,cargo_count_unit=?,' +
      'net_weight_kg=?,gross_weight_kg=?,current_status=?,current_location=?,display_name=?,' +
      'transport_documents_status=?,release_invoice_payment_status=?,updated_at=? ' +
      'WHERE id=? AND organization_id=?',
    ).bind(
      input.registrationOrderId, input.clientId, vessel.id, input.shippingLine, input.billOfLading,
      input.billOfLadingYear, input.voyageNo, input.originPort, input.destinationPort,
      input.cargoCount, input.cargoCountUnit, input.netWeightKg, input.grossWeightKg,
      input.currentStatus, input.currentLocation, name, input.transportDocumentsStatus,
      input.releaseInvoicePaymentStatus, now, id, profile.organization_id,
    ));
    statements.push(customsDataUpsert(db, id!, profile.organization_id, input, profile.id, now));
    await db.batch(statements);
    const saved = await getShipment(db, id!, profile.organization_id);
    return saved ? json({ ok: true, shipment: saved }) : fail('SHIPMENT_WRITE_NOT_CONFIRMED', 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('UNIQUE constraint failed')) return fail('DUPLICATE_BILL_OF_LADING', 409);
    return fail('SHIPMENTS_API_NOT_READY', 503);
  }
};
