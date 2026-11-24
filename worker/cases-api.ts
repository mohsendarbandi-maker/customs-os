export interface CasesD1Statement {
  bind(...values: unknown[]): CasesD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface CasesD1Database { prepare(sql: string): CasesD1Statement; }
export interface CasesApiProfile { id: string; organization_id: string; role: string; is_active: boolean; }
export interface CaseRecord {
  id: string; case_number: string | null; status: string | null; client_id: string | null;
  client_name: string | null; customs_office_id: string | null; registration_order_no: string | null;
  proforma_no: string | null; cargo_description: string | null; cargo_count: number | null;
  cargo_count_unit: string | null; net_weight_kg: number | null; gross_weight_kg: number | null;
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
  const [shipments, declarations, documents] = await Promise.all([
    db.prepare(
      'SELECT s.id,s.case_id,s.client_id,s.vessel_id,v.name AS vessel_name,s.bill_of_lading_no,s.bill_of_lading_year,' +
      's.voyage_no,s.cargo_count,s.cargo_count_unit,s.net_weight_kg,s.gross_weight_kg,s.current_status,' +
      's.transport_documents_status,s.finance_status,s.ship_passed,s.created_at FROM shipments s ' +
      'LEFT JOIN vessels v ON v.id=s.vessel_id AND v.organization_id=s.organization_id ' +
      'WHERE s.case_id=? AND s.organization_id=? ORDER BY s.created_at DESC,s.id DESC',
    ).bind(id, organizationId).all(),
    db.prepare(
      'SELECT id,shipment_id,kottaj_number,declaration_date,customs_path,assessed_value_irr,total_duties_irr,' +
      'workflow_stage,customs_regime,created_at FROM customs_declarations WHERE case_id=? AND organization_id=? ' +
      'ORDER BY created_at DESC,id DESC',
    ).bind(id, organizationId).all(),
    db.prepare(
      'SELECT id,shipment_id,document_type,original_name,display_name,status,document_number,issue_date,' +
      'issue_date_shamsi,is_archived,created_at FROM customs_documents WHERE case_id=? AND organization_id=? ' +
      'ORDER BY created_at DESC,id DESC LIMIT 200',
    ).bind(id, organizationId).all(),
  ]);
  return { shipments: shipments.results, declarations: declarations.results, documents: documents.results };
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
    'FROM customs_os_audit_events WHERE organization_id=? AND entity_type=? AND entity_id=? ' +
    'ORDER BY created_at DESC,id DESC LIMIT 200',
  ).bind(organizationId, 'case', id).all<{
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
  if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405, { allowed: ['GET'] });

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
