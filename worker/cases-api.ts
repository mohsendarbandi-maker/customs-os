export interface CasesD1Statement {
  bind(...values: unknown[]): CasesD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface CasesD1Database {
  prepare(sql: string): CasesD1Statement;
  batch(statements: CasesD1Statement[]): Promise<unknown[]>;
}
export interface CasesApiProfile { id: string; organization_id: string; role: string; is_active: boolean; }
export interface CaseRecord {
  id: string; case_number: string | null; status: string | null; client_id: string | null;
  client_name: string | null; customs_office_id: string | null; registration_order_no: string | null;
  proforma_no: string | null; cargo_description: string | null; cargo_count: number | null;
  cargo_count_unit: string | null; net_weight_kg: number | null; gross_weight_kg: number | null;
  warehouse_receipt_no: string | null; warehouse_receipt_date: string | null;
  release_status: string | null; valuation_status: string | null;
  unloading_date: string | null; vessel_type: string | null; customs_regime: string | null;
  origin_country_code: string | null; transaction_country_code: string | null; delivery_term: string | null;
  invoice_amount: number | string | null; invoice_currency: string | null;
  insurance_amount_irr: number | string | null; tariff_code: string | null;
  import_duty_rate: number | string | null; customs_fx_rate_irr: number | string | null;
  customs_value_irr: number | string | null; import_duty_irr: number | string | null;
  vat_irr: number | string | null; total_payable_irr: number | string | null;
  display_name: string | null; created_at: string | null; updated_at: string | null;
  shipment_count: number; latest_shipment_id: string | null; shipment_display_name: string | null;
  bill_of_lading_no: string | null; vessel_name: string | null; kottaj_number: string | null;
}

const collection = '/api/cases';
const roles = new Set(['owner', 'admin', 'broker', 'accountant', 'warehouse']);
const selectColumns = [
  'c.id', 'c.case_number', 'c.status', 'c.client_id', 'cl.name AS client_name',
  'c.customs_office_id', 'c.registration_order_no', 'c.proforma_no', 'c.cargo_description',
  'c.cargo_count', 'c.cargo_count_unit', 'c.net_weight_kg', 'c.gross_weight_kg',
  'c.warehouse_receipt_no', 'c.warehouse_receipt_date', 'c.release_status', 'c.valuation_status',
  'c.unloading_date', 'c.vessel_type', 'c.customs_regime',
  'c.origin_country_code', 'c.transaction_country_code', 'c.delivery_term',
  'c.invoice_amount', 'c.invoice_currency', 'c.insurance_amount_irr', 'c.tariff_code',
  'c.import_duty_rate', 'c.customs_fx_rate_irr', 'c.customs_value_irr',
  'c.import_duty_irr', 'c.vat_irr', 'c.total_payable_irr',
  'c.display_name', 'c.created_at', 'c.updated_at',
  '(SELECT COUNT(*) FROM shipments s WHERE s.case_id=c.id AND s.organization_id=c.organization_id) AS shipment_count',
  '(SELECT s.id FROM shipments s WHERE s.case_id=c.id AND s.organization_id=c.organization_id ORDER BY s.created_at DESC,s.id DESC LIMIT 1) AS latest_shipment_id',
  '(SELECT s.display_name FROM shipments s WHERE s.case_id=c.id AND s.organization_id=c.organization_id ORDER BY s.created_at DESC,s.id DESC LIMIT 1) AS shipment_display_name',
  '(SELECT s.bill_of_lading_no FROM shipments s WHERE s.case_id=c.id AND s.organization_id=c.organization_id ORDER BY s.created_at DESC,s.id DESC LIMIT 1) AS bill_of_lading_no',
  '(SELECT v.name FROM shipments s LEFT JOIN vessels v ON v.id=s.vessel_id AND v.organization_id=s.organization_id WHERE s.case_id=c.id AND s.organization_id=c.organization_id ORDER BY s.created_at DESC,s.id DESC LIMIT 1) AS vessel_name',
  '(SELECT d.kottaj_number FROM customs_declarations d WHERE d.case_id=c.id AND d.organization_id=c.organization_id ORDER BY d.created_at DESC,d.id DESC LIMIT 1) AS kottaj_number',
].join(', ');

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
const bounded = (raw: string | null, fallback: number, min: number, max: number) => {
  if (!raw || !raw.trim()) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
};
const readId = (pathname: string): string | null | Response => {
  if (pathname === collection) return null;
  if (!pathname.startsWith(collection + '/')) return fail('NOT_FOUND', 404);
  const raw = pathname.slice(collection.length + 1);
  if (!raw || raw.includes('/')) return fail('INVALID_CASE_ID', 400);
  try {
    const id = decodeURIComponent(raw);
    return id && id.length <= 128 && !id.includes('/') ? id : fail('INVALID_CASE_ID', 400);
  } catch { return fail('INVALID_CASE_ID', 400); }
};
const buildWhere = (search: string, status: string) => {
  const clauses = ['c.organization_id = ?'];
  const values: unknown[] = [];
  if (search) {
    clauses.push(
      '(c.case_number LIKE ? OR c.display_name LIKE ? OR c.registration_order_no LIKE ? OR ' +
      'c.proforma_no LIKE ? OR cl.name LIKE ? OR EXISTS (' +
      'SELECT 1 FROM shipments sx WHERE sx.case_id=c.id AND sx.organization_id=c.organization_id AND sx.bill_of_lading_no LIKE ?))',
    );
    const pattern = '%' + search + '%';
    values.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }
  if (status) { clauses.push('c.status = ?'); values.push(status); }
  return { sql: clauses.join(' AND '), values };
};
const readCase = (db: CasesD1Database, id: string, organizationId: string) =>
  db.prepare(
    'SELECT ' + selectColumns + ' FROM cases c LEFT JOIN clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id ' +
    'WHERE c.id=? AND c.organization_id=? LIMIT 1',
  ).bind(id, organizationId).first<CaseRecord>();

const readRelated = async (db: CasesD1Database, id: string, organizationId: string) => {
  const [shipments, declarations, documents, permits] = await Promise.all([
    db.prepare(
      'SELECT s.id,s.case_id,s.client_id,s.vessel_id,v.name AS vessel_name,s.bill_of_lading_no,s.bill_of_lading_year,' +
      's.voyage_no,s.cargo_count,s.cargo_count_unit,s.net_weight_kg,s.gross_weight_kg,s.current_status,' +
      's.transport_documents_status,s.finance_status,s.ship_passed,s.created_at,' +
      'sc.vessel_type,sc.registration_order_no,sc.registration_order_date_shamsi,sc.package_count,' +
      'sc.warehouse_receipt_no,sc.warehouse_receipt_date_shamsi,sc.cargo_description AS customs_cargo_description,' +
      'sc.origin_country,sc.transaction_country,sc.delivery_term,sc.invoice_amount,sc.invoice_currency,' +
      'sc.bank_branch_code,sc.bank_name,sc.bank_branch,sc.lc_number,sc.duty_rate,sc.tariff_code,' +
      'sc.net_weight_kg AS customs_net_weight_kg,sc.gross_weight_kg AS customs_gross_weight_kg,' +
      'sc.bill_of_lading AS customs_bill_of_lading,sc.insurance_irr,sc.required_documents,' +
      'sc.customs_office_id AS customs_data_office_id,sc.customs_regime,sc.sata_code ' +
      'FROM shipments s LEFT JOIN vessels v ON v.id=s.vessel_id AND v.organization_id=s.organization_id ' +
      'LEFT JOIN shipment_customs_data sc ON sc.shipment_id=s.id AND sc.organization_id=s.organization_id ' +
      'WHERE s.case_id=? AND s.organization_id=? ORDER BY s.created_at DESC,s.id DESC',
    ).bind(id, organizationId).all(),
    db.prepare(
      'SELECT id,shipment_id,kottaj_number,declaration_date,customs_path,assessed_value_irr,total_duties_irr,payment_reference,' +
      'workflow_stage,customs_regime,created_at FROM customs_declarations WHERE case_id=? AND organization_id=? ' +
      'ORDER BY created_at DESC,id DESC',
    ).bind(id, organizationId).all(),
    db.prepare(
      'SELECT id,shipment_id,document_type,original_name,display_name,status,document_number,issue_date,' +
      'issue_date_shamsi,is_archived,created_at FROM customs_documents WHERE case_id=? AND organization_id=? ' +
      'ORDER BY created_at DESC,id DESC LIMIT 200',
    ).bind(id, organizationId).all(),
    db.prepare(
      'SELECT id,organization_id,case_id,permit_type,permit_number,issuing_authority,status,issued_at,expires_at,created_at,updated_at ' +
      'FROM permits WHERE case_id=? AND organization_id=? ORDER BY created_at DESC,id DESC LIMIT 200',
    ).bind(id, organizationId).all(),
  ]);
  return {
    shipments: shipments.results,
    declarations: declarations.results,
    documents: documents.results,
    permits: permits.results,
  };
};

const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
};
const stringFields = new Set([
  'case_number','registration_order_no','proforma_no','cargo_description','cargo_count_unit',
  'warehouse_receipt_no','vessel_type','origin_country_code','transaction_country_code',
  'delivery_term','tariff_code',
]);
const dateFields = new Set(['unloading_date','warehouse_receipt_date']);
const numericFields = new Set([
  'cargo_count','net_weight_kg','gross_weight_kg','invoice_amount','insurance_amount_irr','import_duty_rate',
]);
const releaseStatuses = new Set(['pending','invoice_received','paid','released']);
const valuationStatuses = new Set(['pending','calculated','reviewed','approved']);
const maxBodyBytes = 32 * 1024;

const readJsonBody = async (request: Request): Promise<Record<string, unknown> | Response> => {
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > maxBodyBytes) return fail('REQUEST_TOO_LARGE', 413);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) return fail('REQUEST_TOO_LARGE', 413);
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('INVALID_JSON_BODY', 400);
    return body as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 400);
  }
};
const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const decimalNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const raw = normalizeDigits(String(value)).replace(/[٬,\s]/g, '').trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed <= Number.MAX_SAFE_INTEGER ? parsed : null;
};
const patchCase = async (request: Request, db: CasesD1Database, id: string, organizationId: string, actorId: string, url: URL) => {
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  const parsed = await readJsonBody(request);
  if (parsed instanceof Response) return parsed;
  const input = parsed;
  const allowed = new Set([...stringFields, ...dateFields, ...numericFields, 'invoice_currency', 'release_status', 'valuation_status']);
  const keys = Object.keys(input);
  if (!keys.length || keys.some(key => !allowed.has(key))) return fail('INVALID_CASE_PATCH', 422);

  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    const value = input[key];
    if (stringFields.has(key)) {
      if (value !== null && typeof value !== 'string') return fail('INVALID_CASE_PATCH', 422);
      const text = typeof value === 'string' ? value.trim() : null;
      if (key === 'case_number' && (!text || text.length > 100)) return fail('INVALID_CASE_NUMBER', 422);
      const max = key === 'cargo_description' ? 4000 : key === 'cargo_count_unit' ? 40 : 255;
      if (text !== null && text.length > max) return fail('INVALID_CASE_PATCH', 422);
      normalized[key] = ['origin_country_code','transaction_country_code','delivery_term','tariff_code'].includes(key)
        ? (text ? text.toUpperCase() : text)
        : text;
    } else if (dateFields.has(key)) {
      if (value !== null && (typeof value !== 'string' || !isIsoDate(value))) return fail('INVALID_CASE_DATE', 422);
      normalized[key] = value;
    } else if (numericFields.has(key)) {
      if (value === null) {
        normalized[key] = null;
      } else {
        const parsedValue = decimalNumber(value);
        if (parsedValue === null) return fail('INVALID_CASE_NUMBER_VALUE', 422);
        normalized[key] = parsedValue;
      }
    } else if (key === 'invoice_currency') {
      if (value !== null && (typeof value !== 'string' || !/^[A-Za-z]{3,4}$/.test(value.trim()))) {
        return fail('INVALID_INVOICE_CURRENCY', 422);
      }
      normalized[key] = typeof value === 'string' ? value.trim().toUpperCase() : null;
    } else if (key === 'release_status') {
      if (value !== null && (typeof value !== 'string' || !releaseStatuses.has(value))) return fail('INVALID_RELEASE_STATUS', 422);
      normalized[key] = value;
    } else if (key === 'valuation_status') {
      if (value !== null && (typeof value !== 'string' || !valuationStatuses.has(value))) return fail('INVALID_VALUATION_STATUS', 422);
      normalized[key] = value;
    }
  }

  for (const key of ['cargo_count','net_weight_kg','gross_weight_kg','invoice_amount','insurance_amount_irr','import_duty_rate']) {
    const value = normalized[key];
    if (typeof value === 'number' && value < 0) return fail('INVALID_CASE_NUMBER_VALUE', 422);
  }
  const before = await readCase(db, id, organizationId).catch(() => null);
  if (!before) return fail('CASE_NOT_FOUND', 404);
  const nextNetWeight = normalized.net_weight_kg !== undefined ? normalized.net_weight_kg : before.net_weight_kg;
  const nextGrossWeight = normalized.gross_weight_kg !== undefined ? normalized.gross_weight_kg : before.gross_weight_kg;
  if (nextNetWeight !== null && nextGrossWeight !== null &&
      Number(nextGrossWeight) < Number(nextNetWeight)) {
    return fail('GROSS_WEIGHT_BELOW_NET_WEIGHT', 422);
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const beforeSnapshot: Record<string, unknown> = {};
  const afterSnapshot: Record<string, unknown> = {};
  const currentRecord = before as unknown as Record<string, unknown>;
  for (const key of keys) {
    const previous = currentRecord[key] ?? null;
    const next = normalized[key];
    beforeSnapshot[key] = previous;
    afterSnapshot[key] = next;
    if (Object.is(previous, next)) continue;
    sets.push(key + '=?');
    values.push(next);
  }

  // The source workflow advances a draft/registration-order case once unloading
  // or the warehouse receipt has been recorded. Never move a later case backward.
  const nextReceipt = normalized.warehouse_receipt_no !== undefined
    ? normalized.warehouse_receipt_no : before.warehouse_receipt_no;
  const nextUnloading = normalized.unloading_date !== undefined
    ? normalized.unloading_date : before.unloading_date;
  const advanceToDocuments = ['draft','registration_order'].includes(String(before.status || '')) &&
    (Boolean(nextReceipt) || Boolean(nextUnloading));
  if (advanceToDocuments) {
    beforeSnapshot.status = before.status;
    afterSnapshot.status = 'documents_ready';
    if (before.status !== 'documents_ready') {
      sets.push('status=?');
      values.push('documents_ready');
    }
  }
  if (!sets.length) return json({ ok: true, case: before, unchanged: true });
  sets.push("updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  values.push(id, organizationId);
  try {
    const results = await db.batch([
      db.prepare(
        'UPDATE cases SET ' + sets.join(', ') + ' WHERE id=? AND organization_id=? AND updated_at IS ?',
      ).bind(...values, before.updated_at),
      db.prepare(
        'INSERT INTO customs_os_audit_events ' +
        '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
        'SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0',
      ).bind(
        crypto.randomUUID(), organizationId, actorId, 'update', 'case', id,
        JSON.stringify(beforeSnapshot), JSON.stringify(afterSnapshot),
        request.headers.get('cf-ray') || request.headers.get('x-request-id') || null,
      ),
    ]);
    const updateResult = results[0] as { meta?: { changes?: number } } | undefined;
    if (Number(updateResult?.meta?.changes || 0) !== 1) {
      const current = await readCase(db, id, organizationId);
      return current ? fail('CASE_UPDATE_CONFLICT', 409) : fail('CASE_NOT_FOUND', 404);
    }
    const saved = await readCase(db, id, organizationId);
    return saved ? json({ ok: true, case: saved, stageAdvanced: advanceToDocuments })
      : fail('CASE_UPDATE_NOT_CONFIRMED', 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE constraint failed/i.test(message)) return fail('CASE_NUMBER_EXISTS', 409);
    return fail('CASE_UPDATE_FAILED', 500);
  }
};

const createCase = async (
  request: Request, db: CasesD1Database, organizationId: string, actorId: string, url: URL,
) => {
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  const parsed = await readJsonBody(request);
  if (parsed instanceof Response) return parsed;
  const clientId = typeof parsed.client_id === 'string' ? parsed.client_id.trim() : '';
  const registrationOrderNo = typeof parsed.registration_order_no === 'string'
    ? parsed.registration_order_no.trim() : '';
  if (!clientId || clientId.length > 128) return fail('CLIENT_REQUIRED', 422);
  if (parsed.registration_order_no !== undefined && parsed.registration_order_no !== null &&
      (typeof parsed.registration_order_no !== 'string' || registrationOrderNo.length > 100)) {
    return fail('INVALID_REGISTRATION_ORDER_NUMBER', 422);
  }

  // Preserve the legacy idempotency rule: an existing order number in this
  // organization resolves to its current case rather than creating a second one.
  if (registrationOrderNo) {
    const existing = await db.prepare(
      'SELECT id FROM cases WHERE organization_id=? AND registration_order_no=? ORDER BY created_at,id LIMIT 1',
    ).bind(organizationId, registrationOrderNo).first<{ id: string }>();
    if (existing?.id) {
      const record = await readCase(db, existing.id, organizationId);
      if (!record) return fail('CASE_NOT_FOUND', 404);
      if (record.client_id !== clientId) return fail('REGISTRATION_ORDER_CLIENT_MISMATCH', 409);
      return json({ ok: true, case: record, created: false });
    }
  }

  const client = await db.prepare(
    'SELECT id FROM clients WHERE id=? AND organization_id=? LIMIT 1',
  ).bind(clientId, organizationId).first<{ id: string }>();
  if (!client) return fail('CLIENT_NOT_FOUND', 404);

  const id = crypto.randomUUID();
  const randomSuffix = id.replace(/-/g, '').slice(0, 8).toUpperCase();
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const caseNumber = 'CASE-' + timestamp + '-' + randomSuffix;
  const status = registrationOrderNo ? 'registration_order' : 'draft';
  const now = new Date().toISOString();
  try {
    const results = await db.batch([
      db.prepare(
        'INSERT INTO cases (id,organization_id,client_id,case_number,status,registration_order_no,created_at,updated_at) ' +
        'SELECT ?,?,?,?,?,?,?,? WHERE ? IS NULL OR NOT EXISTS ' +
        '(SELECT 1 FROM cases WHERE organization_id=? AND registration_order_no=?)',
      ).bind(
        id, organizationId, clientId, caseNumber, status, registrationOrderNo || null, now, now,
        registrationOrderNo || null, organizationId, registrationOrderNo || null,
      ),
      db.prepare(
        'INSERT INTO customs_os_audit_events ' +
        '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
        'SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0',
      ).bind(
        crypto.randomUUID(), organizationId, actorId, 'create', 'case', id, null,
        JSON.stringify({ case_number: caseNumber, client_id: clientId, status, registration_order_no: registrationOrderNo || null }),
        request.headers.get('cf-ray') || request.headers.get('x-request-id') || null,
      ),
    ]);
    const inserted = Number((results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes || 0) === 1;
    if (!inserted && registrationOrderNo) {
      const existing = await db.prepare(
        'SELECT id FROM cases WHERE organization_id=? AND registration_order_no=? ORDER BY created_at,id LIMIT 1',
      ).bind(organizationId, registrationOrderNo).first<{ id: string }>();
      if (existing?.id) {
        const record = await readCase(db, existing.id, organizationId);
        if (!record) return fail('CASE_NOT_FOUND', 404);
        if (record.client_id !== clientId) return fail('REGISTRATION_ORDER_CLIENT_MISMATCH', 409);
        return json({ ok: true, case: record, created: false });
      }
    }
    if (!inserted) return fail('CASE_CREATE_CONFLICT', 409);
    const saved = await readCase(db, id, organizationId);
    return saved ? json({ ok: true, case: saved, created: true }, 201) : fail('CASE_CREATE_NOT_CONFIRMED', 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE constraint failed/i.test(message)) return fail('CASE_NUMBER_EXISTS', 409);
    if (/FOREIGN KEY constraint failed/i.test(message)) return fail('CLIENT_NOT_FOUND', 404);
    return fail('CASE_CREATE_FAILED', 500);
  }
};

const decimalToScaled = (value: unknown, decimalPlaces: number): bigint | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const raw = normalizeDigits(String(value)).replace(/[٬,\s]/g, '').trim();
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || (match[2]?.length || 0) > decimalPlaces) return null;
  const scale = 10n ** BigInt(decimalPlaces);
  const fraction = (match[2] || '').padEnd(decimalPlaces, '0');
  try { return BigInt(match[1]) * scale + BigInt(fraction || '0'); }
  catch { return null; }
};
const roundedDivide = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator / 2n) / denominator;
const formatScaled = (value: bigint, decimalPlaces: number) => {
  const scale = 10n ** BigInt(decimalPlaces);
  const integer = value / scale;
  const fraction = (value % scale).toString().padStart(decimalPlaces, '0').replace(/0+$/, '');
  return fraction ? integer.toString() + '.' + fraction : integer.toString();
};
const calculateCaseValuation = async (
  request: Request, db: CasesD1Database, id: string, organizationId: string, actorId: string, url: URL,
) => {
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  const parsed = await readJsonBody(request);
  if (parsed instanceof Response) return parsed;
  if (Object.keys(parsed).some(key => !['customs_fx_rate_irr','import_duty_rate','vat_rate'].includes(key))) {
    return fail('INVALID_VALUATION_INPUT', 422);
  }
  const fx = decimalToScaled(parsed.customs_fx_rate_irr, 6);
  const dutyRate = decimalToScaled(parsed.import_duty_rate, 6);
  const vatRate = decimalToScaled(parsed.vat_rate === undefined ? 10 : parsed.vat_rate, 6);
  if (fx === null || fx <= 0n || dutyRate === null || dutyRate < 0n || vatRate === null || vatRate < 0n) {
    return fail('INVALID_VALUATION_RATE', 422);
  }
  const before = await readCase(db, id, organizationId).catch(() => null);
  if (!before) return fail('CASE_NOT_FOUND', 404);
  const invoice = decimalToScaled(before.invoice_amount, 6);
  const insurance = decimalToScaled(before.insurance_amount_irr, 6);
  if (invoice === null || invoice <= 0n) return fail('INVOICE_AMOUNT_REQUIRED', 422);
  if (!before.invoice_currency) return fail('INVOICE_CURRENCY_REQUIRED', 422);
  if (insurance === null) return fail('INSURANCE_AMOUNT_REQUIRED', 422);

  const scale = 1_000_000n;
  const invoiceInIrr = before.invoice_currency.toUpperCase() === 'IRR'
    ? invoice
    : roundedDivide(invoice * fx, scale);
  const customsValue = invoiceInIrr + insurance;
  const duty = roundedDivide(customsValue * dutyRate, scale * 100n);
  const vatBase = customsValue + duty;
  const vat = roundedDivide(vatBase * vatRate, scale * 100n);
  const total = duty + vat;
  const after = {
    customs_fx_rate_irr: formatScaled(fx, 6),
    import_duty_rate: formatScaled(dutyRate, 6),
    customs_value_irr: formatScaled(customsValue, 6),
    import_duty_irr: formatScaled(duty, 6),
    vat_irr: formatScaled(vat, 6),
    total_payable_irr: formatScaled(total, 6),
    valuation_status: 'calculated',
    status: 'duties_calculation',
  };
  const beforeSnapshot = {
    customs_fx_rate_irr: before.customs_fx_rate_irr,
    import_duty_rate: before.import_duty_rate,
    customs_value_irr: before.customs_value_irr,
    import_duty_irr: before.import_duty_irr,
    vat_irr: before.vat_irr,
    total_payable_irr: before.total_payable_irr,
    valuation_status: before.valuation_status,
    status: before.status,
  };
  try {
    const results = await db.batch([
      db.prepare(
        'UPDATE cases SET customs_fx_rate_irr=?,import_duty_rate=?,customs_value_irr=?,import_duty_irr=?,' +
        'vat_irr=?,total_payable_irr=?,valuation_status=?,status=?,updated_at=strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') ' +
        'WHERE id=? AND organization_id=? AND updated_at IS ?',
      ).bind(
        after.customs_fx_rate_irr, after.import_duty_rate, after.customs_value_irr,
        after.import_duty_irr, after.vat_irr, after.total_payable_irr,
        after.valuation_status, after.status, id, organizationId, before.updated_at,
      ),
      db.prepare(
        'INSERT INTO customs_os_audit_events ' +
        '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
        'SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0',
      ).bind(
        crypto.randomUUID(), organizationId, actorId, 'update', 'case', id,
        JSON.stringify(beforeSnapshot), JSON.stringify(after),
        request.headers.get('cf-ray') || request.headers.get('x-request-id') || null,
      ),
    ]);
    const updateResult = results[0] as { meta?: { changes?: number } } | undefined;
    if (Number(updateResult?.meta?.changes || 0) !== 1) {
      const current = await readCase(db, id, organizationId);
      return current ? fail('CASE_UPDATE_CONFLICT', 409) : fail('CASE_NOT_FOUND', 404);
    }
    const saved = await readCase(db, id, organizationId);
    return saved ? json({
      ok: true,
      case: saved,
      valuation: {
        customs_value_irr: after.customs_value_irr,
        import_duty_irr: after.import_duty_irr,
        vat_irr: after.vat_irr,
        total_payable_irr: after.total_payable_irr,
        customs_fx_rate_irr: after.customs_fx_rate_irr,
        import_duty_rate: after.import_duty_rate,
        vat_rate: formatScaled(vatRate, 6),
      },
    }) : fail('CASE_UPDATE_NOT_CONFIRMED', 500);
  } catch {
    return fail('CASE_VALUATION_FAILED', 500);
  }
};

const completeCaseValuation = async (
  request: Request, db: CasesD1Database, id: string, organizationId: string, actorId: string, url: URL,
) => {
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  const parsed = await readJsonBody(request);
  if (parsed instanceof Response) return parsed;
  const allowedFields = new Set([
    'customs_value_irr', 'import_duty_rate', 'import_duty_irr', 'vat_irr', 'total_payable_irr',
  ]);
  if (Object.keys(parsed).some(key => !allowedFields.has(key))) return fail('INVALID_VALUATION_INPUT', 422);

  const customsValue = decimalToScaled(parsed.customs_value_irr, 6);
  if (customsValue === null) return fail('CUSTOMS_VALUE_REQUIRED', 422);
  const optional = (value: unknown): bigint | null | false => {
    if (value === null || value === undefined || value === '') return null;
    const parsedValue = decimalToScaled(value, 6);
    return parsedValue === null ? false : parsedValue;
  };
  const dutyRate = optional(parsed.import_duty_rate);
  const duty = optional(parsed.import_duty_irr);
  const vat = optional(parsed.vat_irr);
  const total = optional(parsed.total_payable_irr);
  if ([dutyRate, duty, vat, total].some(value => value === false)) {
    return fail('INVALID_VALUATION_AMOUNT', 422);
  }

  const before = await readCase(db, id, organizationId).catch(() => null);
  if (!before) return fail('CASE_NOT_FOUND', 404);
  const allowedStages = new Set(['path_green', 'path_yellow', 'path_red', 'valuation']);
  if (!allowedStages.has(String(before.status || ''))) return fail('VALUATION_STAGE_NOT_READY', 409);

  const after = {
    customs_value_irr: formatScaled(customsValue, 6),
    import_duty_rate: dutyRate === null ? null : formatScaled(dutyRate, 6),
    import_duty_irr: duty === null ? null : formatScaled(duty, 6),
    vat_irr: vat === null ? null : formatScaled(vat, 6),
    total_payable_irr: total === null ? null : formatScaled(total, 6),
    status: 'valuation',
  };
  const beforeSnapshot = {
    customs_value_irr: before.customs_value_irr,
    import_duty_rate: before.import_duty_rate,
    import_duty_irr: before.import_duty_irr,
    vat_irr: before.vat_irr,
    total_payable_irr: before.total_payable_irr,
    status: before.status,
  };
  try {
    const results = await db.batch([
      db.prepare(
        'UPDATE cases SET customs_value_irr=?,import_duty_rate=?,import_duty_irr=?,vat_irr=?,' +
        'total_payable_irr=?,status=?,updated_at=strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') ' +
        'WHERE id=? AND organization_id=? AND updated_at IS ?',
      ).bind(
        after.customs_value_irr, after.import_duty_rate, after.import_duty_irr,
        after.vat_irr, after.total_payable_irr, after.status, id, organizationId, before.updated_at,
      ),
      db.prepare(
        'INSERT INTO customs_os_audit_events ' +
        '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
        'SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0',
      ).bind(
        crypto.randomUUID(), organizationId, actorId, 'update', 'case', id,
        JSON.stringify(beforeSnapshot), JSON.stringify(after),
        request.headers.get('cf-ray') || request.headers.get('x-request-id') || null,
      ),
    ]);
    const updateResult = results[0] as { meta?: { changes?: number } } | undefined;
    if (Number(updateResult?.meta?.changes || 0) !== 1) {
      const current = await readCase(db, id, organizationId);
      return current ? fail('CASE_UPDATE_CONFLICT', 409) : fail('CASE_NOT_FOUND', 404);
    }
    const saved = await readCase(db, id, organizationId);
    return saved ? json({
      ok: true,
      case: saved,
      valuation: after,
    }) : fail('CASE_UPDATE_NOT_CONFIRMED', 500);
  } catch {
    return fail('CASE_VALUATION_FAILED', 500);
  }
};

interface PermitRecord {
  id: string;
  organization_id: string;
  case_id: string;
  permit_type: string;
  permit_number: string | null;
  issuing_authority: string;
  status: 'pending' | 'approved' | 'rejected' | 'not_required';
  issued_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}
interface CasePermitRoute { caseId: string; permitId: string | null; }
const permitStatuses = new Set(['pending', 'approved', 'rejected', 'not_required']);
const permitColumns = 'id,organization_id,case_id,permit_type,permit_number,issuing_authority,status,issued_at,expires_at,created_at,updated_at';

const parseCasePermitRoute = (pathname: string): CasePermitRoute | Response | null => {
  if (!pathname.startsWith(collection + '/')) return null;
  const segments = pathname.slice(collection.length + 1).split('/');
  if (segments.length < 2 || segments[1] !== 'permits') return null;
  if (segments.length > 3 || !segments[0] || (segments.length === 3 && !segments[2])) {
    return fail('INVALID_PERMIT_ROUTE', 400);
  }
  try {
    const caseId = decodeURIComponent(segments[0]);
    const permitId = segments.length === 3 ? decodeURIComponent(segments[2]) : null;
    if (!caseId || caseId.length > 128 || caseId.includes('/') ||
        (permitId !== null && (!permitId || permitId.length > 128 || permitId.includes('/')))) {
      return fail('INVALID_PERMIT_ROUTE', 400);
    }
    return { caseId, permitId };
  } catch {
    return fail('INVALID_PERMIT_ROUTE', 400);
  }
};

const permitInput = (value: unknown, partial: boolean): Record<string, unknown> | Response => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_PERMIT_INPUT', 422);
  const raw = value as Record<string, unknown>;
  const allowed = new Set(['permit_type', 'permit_number', 'issuing_authority', 'status', 'issued_at', 'expires_at']);
  const keys = Object.keys(raw);
  if (!keys.length || keys.some(key => !allowed.has(key))) return fail('INVALID_PERMIT_INPUT', 422);
  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    const item = raw[key];
    if (key === 'permit_type' || key === 'issuing_authority' || key === 'permit_number') {
      if (item !== null && typeof item !== 'string') return fail('INVALID_PERMIT_INPUT', 422);
      const text = typeof item === 'string' ? item.trim() : null;
      const max = key === 'issuing_authority' ? 255 : 100;
      if (text !== null && text.length > max) return fail('INVALID_PERMIT_INPUT', 422);
      if ((key === 'permit_type' || key === 'issuing_authority') && !text) return fail('INVALID_PERMIT_INPUT', 422);
      normalized[key] = key === 'permit_number' && !text ? null : text;
    } else if (key === 'status') {
      if (typeof item !== 'string' || !permitStatuses.has(item)) return fail('INVALID_PERMIT_STATUS', 422);
      normalized[key] = item;
    } else if (key === 'issued_at' || key === 'expires_at') {
      if (item !== null && typeof item !== 'string') return fail('INVALID_PERMIT_DATE', 422);
      const text = typeof item === 'string' ? item.trim() : '';
      if (!text) normalized[key] = null;
      else {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
          return fail('INVALID_PERMIT_DATE', 422);
        }
        const timestamp = Date.parse(text);
        if (!Number.isFinite(timestamp)) return fail('INVALID_PERMIT_DATE', 422);
        normalized[key] = new Date(timestamp).toISOString();
      }
    }
  }
  if (!partial && (!Object.prototype.hasOwnProperty.call(normalized, 'permit_type') ||
      !Object.prototype.hasOwnProperty.call(normalized, 'issuing_authority'))) {
    return fail('INVALID_PERMIT_INPUT', 422, { required: ['permit_type', 'issuing_authority'] });
  }
  return normalized;
};

const readPermitBody = async (request: Request): Promise<Record<string, unknown> | Response> => {
  if (Number(request.headers.get('content-length') || 0) > 16 * 1024) return fail('REQUEST_TOO_LARGE', 413);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16 * 1024) return fail('REQUEST_TOO_LARGE', 413);
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 400);
  }
};
const permitById = (db: CasesD1Database, caseId: string, permitId: string, organizationId: string) =>
  db.prepare('SELECT ' + permitColumns + ' FROM permits WHERE id=? AND case_id=? AND organization_id=? LIMIT 1')
    .bind(permitId, caseId, organizationId).first<PermitRecord>();
const permitsForCase = (db: CasesD1Database, caseId: string, organizationId: string) =>
  db.prepare('SELECT ' + permitColumns + ' FROM permits WHERE case_id=? AND organization_id=? ORDER BY created_at DESC,id DESC LIMIT 200')
    .bind(caseId, organizationId).all<PermitRecord>();
const caseExists = (db: CasesD1Database, caseId: string, organizationId: string) =>
  db.prepare('SELECT id FROM cases WHERE id=? AND organization_id=? LIMIT 1')
    .bind(caseId, organizationId).first<{ id: string }>();
const permitAuditStatement = (
  organizationId: string,
  actorId: string,
  action: 'create' | 'update' | 'delete',
  permitId: string,
  before: PermitRecord | null,
  after: PermitRecord | null,
  request: Request,
) => {
  const now = new Date().toISOString();
  return {
    sql: 'INSERT INTO customs_os_audit_events ' +
      '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id,created_at) ' +
      'SELECT ?,?,?,?,?,?,?,?,?,? WHERE changes()>0',
    values: [
      crypto.randomUUID(), organizationId, actorId, action, 'permit', permitId,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
      request.headers.get('cf-ray') || request.headers.get('x-request-id') || crypto.randomUUID(), now,
    ],
  };
};

const handleCasePermitsApi = async (
  request: Request,
  db: CasesD1Database,
  url: URL,
  profile: CasesApiProfile,
  route: CasePermitRoute,
): Promise<Response> => {
  const { caseId, permitId } = route;
  if (request.method === 'GET') {
    try {
      if (!await caseExists(db, caseId, profile.organization_id)) return fail('CASE_NOT_FOUND', 404);
      if (permitId) {
        const permit = await permitById(db, caseId, permitId, profile.organization_id);
        return permit ? json({ ok: true, permit }) : fail('PERMIT_NOT_FOUND', 404);
      }
      const result = await permitsForCase(db, caseId, profile.organization_id);
      return json({ ok: true, permits: result.results, caseId });
    } catch {
      return fail('CASE_PERMITS_API_NOT_READY', 503);
    }
  }

  if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) {
    return fail('METHOD_NOT_ALLOWED', 405, { allowed: permitId ? ['GET', 'PATCH', 'DELETE'] : ['GET', 'POST'] });
  }
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  if (!['owner', 'admin', 'broker'].includes(profile.role)) return fail('FORBIDDEN', 403);

  if (request.method === 'POST') {
    if (permitId) return fail('NOT_FOUND', 404);
    const raw = await readPermitBody(request);
    if (raw instanceof Response) return raw;
    const input = permitInput(raw, false);
    if (input instanceof Response) return input;
    try {
      if (!await caseExists(db, caseId, profile.organization_id)) return fail('CASE_NOT_FOUND', 404);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const record: PermitRecord = {
        id, organization_id: profile.organization_id, case_id: caseId,
        permit_type: input.permit_type as string,
        permit_number: (input.permit_number as string | null | undefined) ?? null,
        issuing_authority: input.issuing_authority as string,
        status: (input.status as PermitRecord['status'] | undefined) ?? 'pending',
        issued_at: (input.issued_at as string | null | undefined) ?? null,
        expires_at: (input.expires_at as string | null | undefined) ?? null,
        created_at: now, updated_at: now,
      };
      if (record.issued_at && record.expires_at && Date.parse(record.expires_at) < Date.parse(record.issued_at)) {
        return fail('PERMIT_EXPIRY_BEFORE_ISSUE', 422);
      }
      const audit = permitAuditStatement(profile.organization_id, profile.id, 'create', id, null, record, request);
      const results = await db.batch([
        db.prepare(
          'INSERT INTO permits (' + permitColumns + ') VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          record.id, record.organization_id, record.case_id, record.permit_type,
          record.permit_number, record.issuing_authority, record.status,
          record.issued_at, record.expires_at, record.created_at, record.updated_at,
        ),
        db.prepare(audit.sql).bind(...audit.values),
      ]);
      const inserted = results[0] as { meta?: { changes?: number } } | undefined;
      if (Number(inserted?.meta?.changes || 0) !== 1) return fail('PERMIT_CREATE_NOT_CONFIRMED', 500);
      const saved = await permitById(db, caseId, id, profile.organization_id);
      return saved ? json({ ok: true, permit: saved }, 201) : fail('PERMIT_CREATE_NOT_CONFIRMED', 500);
    } catch {
      return fail('PERMIT_CREATE_FAILED', 500);
    }
  }

  if (!permitId) return fail('PERMIT_ID_REQUIRED', 400);
  let before: PermitRecord | null;
  try { before = await permitById(db, caseId, permitId, profile.organization_id); }
  catch { return fail('CASE_PERMITS_API_NOT_READY', 503); }
  if (!before) return fail('PERMIT_NOT_FOUND', 404);

  if (request.method === 'PATCH') {
    const raw = await readPermitBody(request);
    if (raw instanceof Response) return raw;
    const input = permitInput(raw, true);
    if (input instanceof Response) return input;
    const updatedAt = new Date().toISOString();
    const after = { ...before, ...input, updated_at: updatedAt } as PermitRecord;
    if (after.issued_at && after.expires_at && Date.parse(after.expires_at) < Date.parse(after.issued_at)) {
      return fail('PERMIT_EXPIRY_BEFORE_ISSUE', 422);
    }
    const columns = Object.keys(input);
    const changed = columns.filter(key => !Object.is(
      (before as unknown as Record<string, unknown>)[key],
      input[key],
    ));
    if (!changed.length) return json({ ok: true, permit: before, unchanged: true });
    const sets = changed.map(key => key + '=?');
    const values = changed.map(key => input[key]);
    sets.push('updated_at=?');
    values.push(updatedAt);
    const updateAudit = permitAuditStatement(profile.organization_id, profile.id, 'update', permitId, before, after, request);
    try {
      const results = await db.batch([
        db.prepare(
          'UPDATE permits SET ' + sets.join(', ') +
            ' WHERE id=? AND case_id=? AND organization_id=? AND updated_at=?',
        ).bind(...values, permitId, caseId, profile.organization_id, before.updated_at),
        db.prepare(updateAudit.sql).bind(...updateAudit.values),
      ]);
      const changedRows = results[0] as { meta?: { changes?: number } } | undefined;
      if (Number(changedRows?.meta?.changes || 0) !== 1) {
        const current = await permitById(db, caseId, permitId, profile.organization_id);
        return current ? fail('PERMIT_UPDATE_CONFLICT', 409) : fail('PERMIT_NOT_FOUND', 404);
      }
      const saved = await permitById(db, caseId, permitId, profile.organization_id);
      return saved ? json({ ok: true, permit: saved }) : fail('PERMIT_UPDATE_NOT_CONFIRMED', 500);
    } catch {
      return fail('PERMIT_UPDATE_FAILED', 500);
    }
  }

  const deleteAudit = permitAuditStatement(profile.organization_id, profile.id, 'delete', permitId, before, null, request);
  try {
    const results = await db.batch([
      db.prepare('DELETE FROM permits WHERE id=? AND case_id=? AND organization_id=? AND updated_at=?')
        .bind(permitId, caseId, profile.organization_id, before.updated_at),
      db.prepare(deleteAudit.sql).bind(...deleteAudit.values),
    ]);
    const changedRows = results[0] as { meta?: { changes?: number } } | undefined;
    if (Number(changedRows?.meta?.changes || 0) !== 1) {
      const current = await permitById(db, caseId, permitId, profile.organization_id);
      return current ? fail('PERMIT_DELETE_CONFLICT', 409) : fail('PERMIT_NOT_FOUND', 404);
    }
    return json({ ok: true, deleted: true, permitId });
  } catch {
    return fail('PERMIT_DELETE_FAILED', 500);
  }
};

const parseSnapshot = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const readCaseHistory = async (db: CasesD1Database, id: string, organizationId: string) => {
  const record = await readCase(db, id, organizationId);
  if (!record) return fail('CASE_NOT_FOUND', 404);
  const events = await db.prepare(
    'SELECT id,actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at ' +
    'FROM customs_os_audit_events WHERE organization_id=? AND (' +
    '(entity_type=? AND entity_id=?) OR ' +
    '(entity_type=? AND CASE WHEN json_valid(COALESCE(before_json,after_json)) THEN json_extract(COALESCE(before_json,after_json),\'$.case_id\') ELSE NULL END=?)' +
    ') ORDER BY created_at DESC,id DESC LIMIT 200',
  ).bind(organizationId, 'case', id, 'permit', id).all<{
    id: string;
    actor_user_id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    before_json: string | null;
    after_json: string | null;
    created_at: string;
  }>();
  const audit = events.results.map((event) => ({
    id: event.id,
    user_id: event.actor_user_id,
    action: event.action === 'create' ? 'INSERT' : event.action === 'delete' ? 'DELETE' : 'UPDATE',
    table_name: event.entity_type,
    record_id: event.entity_id,
    old_data: event.before_json,
    new_data: event.after_json,
    created_at: event.created_at,
  }));
  const history = events.results.flatMap((event) => {
    if (event.entity_type !== 'case') return [];
    const before = parseSnapshot(event.before_json);
    const after = parseSnapshot(event.after_json);
    const previousStatus = typeof before.status === 'string' ? before.status
      : typeof before.case_status === 'string' ? before.case_status : null;
    const newStatus = typeof after.status === 'string' ? after.status
      : typeof after.case_status === 'string' ? after.case_status : null;
    if (!newStatus || previousStatus === newStatus) return [];
    return [{
      id: event.id,
      case_id: id,
      changed_by: event.actor_user_id,
      previous_status: previousStatus,
      new_status: newStatus,
      notes: typeof after.notes === 'string' ? after.notes
        : typeof after.change_notes === 'string' ? after.change_notes : null,
      created_at: event.created_at,
    }];
  });
  return json({
    ok: true,
    case: {
      id: record.id,
      case_number: record.case_number,
      status: record.status,
      client_id: record.client_id,
      created_at: record.created_at,
    },
    history,
    audit,
    historySource: 'customs_os_audit_events',
    legacyHistoryBackfill: 'not_imported',
    dataScope: 'authenticated_organization_only',
  });
};

export const handleCasesApi = async (
  request: Request,
  db: CasesD1Database,
  url: URL,
  profile: CasesApiProfile,
): Promise<Response> => {
  if (!profile.is_active || !roles.has(profile.role)) return fail('FORBIDDEN', 403);
  if (!profile.id || !profile.organization_id) return fail('INVALID_SESSION_PROFILE', 401);
  const permitRoute = parseCasePermitRoute(url.pathname);
  if (permitRoute instanceof Response) return permitRoute;
  if (permitRoute) return handleCasePermitsApi(request, db, url, profile, permitRoute);
  if (url.pathname === collection && request.method === 'POST') {
    if (!['owner','admin','broker'].includes(profile.role)) return fail('FORBIDDEN', 403);
    return createCase(request, db, profile.organization_id, profile.id, url);
  }
  const valuationCalculationRoute = url.pathname.startsWith(collection + '/') && url.pathname.endsWith('/valuation/calculate');
  if (valuationCalculationRoute) {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405, { allowed: ['POST'] });
    if (!['owner','admin','broker'].includes(profile.role)) return fail('FORBIDDEN', 403);
    const rawId = url.pathname.slice(collection.length + 1, -'/valuation/calculate'.length);
    if (!rawId || rawId.includes('/')) return fail('INVALID_CASE_ID', 400);
    let calculationId: string;
    try { calculationId = decodeURIComponent(rawId); }
    catch { return fail('INVALID_CASE_ID', 400); }
    if (!calculationId || calculationId.length > 128 || calculationId.includes('/')) return fail('INVALID_CASE_ID', 400);
    return calculateCaseValuation(request, db, calculationId, profile.organization_id, profile.id, url);
  }
  const valuationRoute = url.pathname.startsWith(collection + '/') && url.pathname.endsWith('/valuation');
  if (valuationRoute) {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405, { allowed: ['POST'] });
    if (!['owner','admin','broker'].includes(profile.role)) return fail('FORBIDDEN', 403);
    const rawId = url.pathname.slice(collection.length + 1, -'/valuation'.length);
    if (!rawId || rawId.includes('/')) return fail('INVALID_CASE_ID', 400);
    let valuationId: string;
    try { valuationId = decodeURIComponent(rawId); }
    catch { return fail('INVALID_CASE_ID', 400); }
    if (!valuationId || valuationId.length > 128 || valuationId.includes('/')) return fail('INVALID_CASE_ID', 400);
    return completeCaseValuation(request, db, valuationId, profile.organization_id, profile.id, url);
  }
  const historyRoute = url.pathname.startsWith(collection + '/') && url.pathname.endsWith('/history');
  if (historyRoute) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405, { allowed: ['GET'] });
    const rawId = url.pathname.slice(collection.length + 1, -'/history'.length);
    if (!rawId || rawId.includes('/')) return fail('INVALID_CASE_ID', 400);
    let historyId: string;
    try { historyId = decodeURIComponent(rawId); }
    catch { return fail('INVALID_CASE_ID', 400); }
    if (!historyId || historyId.length > 128 || historyId.includes('/')) return fail('INVALID_CASE_ID', 400);
    try { return await readCaseHistory(db, historyId, profile.organization_id); }
    catch { return fail('CASE_HISTORY_API_NOT_READY', 503); }
  }

  const id = readId(url.pathname);
  if (id instanceof Response) return id;
  if (request.method === 'PATCH') {
    if (id === null) return fail('CASE_ID_REQUIRED', 400);
    if (!['owner','admin','broker'].includes(profile.role)) return fail('FORBIDDEN', 403);
    return patchCase(request, db, id, profile.organization_id, profile.id, url);
  }
  if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405, { allowed: id === null ? ['GET','POST'] : ['GET', 'PATCH'] });

  try {
    if (id !== null) {
      const record = await readCase(db, id, profile.organization_id);
      if (!record) return fail('CASE_NOT_FOUND', 404);
      const related = await readRelated(db, id, profile.organization_id);
      return json({
        ok: true,
        case: record,
        ...related,
        readOnly: true,
        workflowReadiness: 'not_included',
        stageTransitions: 'not_supported',
      });
    }
    const limit = bounded(url.searchParams.get('limit'), 30, 1, 100);
    const offset = bounded(url.searchParams.get('offset'), 0, 0, 1000000);
    const search = normalizeDigits((url.searchParams.get('search') || '').trim()).slice(0, 100);
    const status = (url.searchParams.get('status') || '').trim().slice(0, 80);
    const filter = buildWhere(search, status);
    const values = [profile.organization_id, ...filter.values];
    const count = await db.prepare(
      'SELECT COUNT(*) AS total FROM cases c LEFT JOIN clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id WHERE ' + filter.sql,
    ).bind(...values).first<{ total: number }>();
    const rows = await db.prepare(
      'SELECT ' + selectColumns + ' FROM cases c LEFT JOIN clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id ' +
      'WHERE ' + filter.sql + ' ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?',
    ).bind(...values, limit, offset).all<CaseRecord>();
    return json({
      ok: true,
      items: rows.results,
      total: Number(count?.total || 0),
      limit,
      offset,
      searchApplied: Boolean(search),
      statusFilter: status || null,
      dataScope: 'authenticated_organization_only',
      readOnly: true,
    });
  } catch {
    return fail('CASES_API_NOT_READY', 503);
  }
};
