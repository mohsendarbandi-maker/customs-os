import {
  getWorkflowStageIssues,
  type CustomsWorkflowValidationState,
} from '../supabase/functions/_shared/customsDeclarationWorkflow';

export interface CustomsWorkflowD1Statement {
  bind(...values: unknown[]): CustomsWorkflowD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface CustomsWorkflowD1Database {
  prepare(sql: string): CustomsWorkflowD1Statement;
  batch(statements: CustomsWorkflowD1Statement[]): Promise<unknown[]>;
}
export interface CustomsWorkflowProfile {
  id: string;
  organization_id: string;
  role: string;
  is_active: boolean;
}
interface DeclarationRow {
  id: string;
  organization_id: string;
  shipment_id: string | null;
  customs_path: string | null;
  customs_regime: string | null;
  vessel_type: string | null;
  cargo_description: string | null;
  tariff_code: string | null;
  sata_code: string | null;
}
interface WorkflowDbRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  declaration_id: string;
  current_stage: string;
  evaluation_state: string;
  expertise_state: string;
  cashier_state: string;
  loading_permit_state: string;
  exit_state: string;
  port_charges_state: string;
  procedure_state: string;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  last_event_type: string;
}
interface WorkflowRow extends Omit<WorkflowDbRow,
  'evaluation_state' | 'expertise_state' | 'cashier_state' | 'loading_permit_state' |
  'exit_state' | 'port_charges_state' | 'procedure_state'> {
  evaluation_state: JsonObject;
  expertise_state: JsonObject;
  cashier_state: JsonObject;
  loading_permit_state: JsonObject;
  exit_state: JsonObject;
  port_charges_state: JsonObject;
  procedure_state: JsonObject;
}
interface WorkflowEventDbRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  declaration_id: string;
  workflow_id: string;
  event_type: 'created' | 'stage_changed' | 'saved' | 'rollback';
  previous_stage: string | null;
  current_stage: string;
  changed_fields: string;
  previous_snapshot: string | null;
  snapshot: string;
  actor_id: string | null;
  created_at: string;
}
type JsonObject = Record<string, unknown>;
type Activity =
  | 'evaluation' | 'expertise' | 'cashier' | 'loading_permit'
  | 'exit' | 'port_charges' | 'abandoned';
type RouteAction = 'read' | 'events' | 'create' | 'activity' | 'complete' | 'rollback';
interface Route {
  declarationId: string;
  action: RouteAction;
}
const PREFIX = '/api/customs-declaration-workflows';
const READ_ROLES = new Set(['owner', 'admin', 'broker', 'accountant', 'warehouse']);
const WRITE_ROLES = new Set(['owner', 'admin', 'broker', 'warehouse']);
const STATE_COLUMNS: Record<Exclude<Activity, 'abandoned'>, string> = {
  evaluation: 'evaluation_state',
  expertise: 'expertise_state',
  cashier: 'cashier_state',
  loading_permit: 'loading_permit_state',
  exit: 'exit_state',
  port_charges: 'port_charges_state',
};
const ALLOWED_FIELDS: Record<Exclude<Activity, 'abandoned'>, string[]> = {
  evaluation: ['status', 'evaluator_number', 'expert_requested', 'expert_request_note'],
  expertise: ['appointment_status', 'appointment_number', 'road_authority_status', 'plant_quarantine_status', 'standard'],
  cashier: ['method', 'cash_paid_irr', 'guarantee_duties', 'guarantee_vat', 'guarantee_reference'],
  loading_permit: ['clause2_request_status', 'tax_permission_status', 'central_bank_status', 'sata_code', 'clearance_90_percent_requested', 'comment'],
  exit: ['loading_permission_status', 'financial_registration_status', 'weighbridge_required', 'weighbridge_demand_irr', 'weighbridge_paid', 'loading_completed_at'],
  port_charges: ['insurance_policy_no', 'insurance_issue_date', 'insurance_followup_status', 'warehouse_receipt_date', 'initial_invoice_status', 'transport_power_of_attorney_status', 'loading_form_received_at', 'loading_started_at', 'supplemental_invoice_status', 'last_truck_loaded_at'],
};
const STANDARD_FIELDS = new Set([
  'expert_review', 'inspection_status', 'inspection_company', 'inspection_fee',
  'inspection_paid', 'inspection_invoice_received', 'inspection_invoice_status',
  'sample_status', 'laboratory', 'results_uploaded', 'standard_fee',
  'standard_fee_paid', 'standard_notified',
]);
const DEFAULTS = {
  evaluation: { status: 'not_required', evaluator_number: '', expert_requested: false, expert_request_note: '' },
  expertise: {
    appointment_status: 'not_requested', appointment_number: '', road_authority_status: 'not_required',
    plant_quarantine_status: 'not_required',
    standard: {
      expert_review: 'pending', inspection_status: 'not_requested', inspection_company: '',
      inspection_fee: null, inspection_paid: false, inspection_invoice_received: false,
      inspection_invoice_status: 'pending', sample_status: 'not_sent', laboratory: '',
      results_uploaded: false, standard_fee: null, standard_fee_paid: false, standard_notified: false,
    },
  },
  cashier: { method: 'pending', cash_paid_irr: null, guarantee_duties: false, guarantee_vat: false, guarantee_reference: '' },
  loadingPermit: { clause2_request_status: 'not_required', tax_permission_status: 'pending', central_bank_status: 'pending', sata_code: '', clearance_90_percent_requested: false, comment: '' },
  exit: { loading_permission_status: 'pending', financial_registration_status: 'pending', weighbridge_required: false, weighbridge_demand_irr: null, weighbridge_paid: false, loading_completed_at: '' },
  port: { insurance_policy_no: '', insurance_issue_date: '', insurance_followup_status: 'pending', warehouse_receipt_date: '', initial_invoice_status: 'pending', transport_power_of_attorney_status: 'pending', loading_form_received_at: '', loading_started_at: '', supplemental_invoice_status: 'not_required', last_truck_loaded_at: '' },
};
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
const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
};
const parseJsonObject = (value: unknown): JsonObject | null => {
  if (isObject(value)) return value;
  if (typeof value === 'string') {
    try { const parsed: unknown = JSON.parse(value); return isObject(parsed) ? parsed : null; }
    catch { return null; }
  }
  return null;
};
const parseDbObject = (value: string): JsonObject => {
  try { const parsed: unknown = JSON.parse(value); return isObject(parsed) ? parsed : {}; }
  catch { return {}; }
};
const parseRow = (row: WorkflowDbRow): WorkflowRow => ({
  ...row,
  evaluation_state: parseDbObject(row.evaluation_state),
  expertise_state: parseDbObject(row.expertise_state),
  cashier_state: parseDbObject(row.cashier_state),
  loading_permit_state: parseDbObject(row.loading_permit_state),
  exit_state: parseDbObject(row.exit_state),
  port_charges_state: parseDbObject(row.port_charges_state),
  procedure_state: parseDbObject(row.procedure_state),
});
const parseEvent = (row: WorkflowEventDbRow) => ({
  ...row,
  changed_fields: parseJsonArray(row.changed_fields),
  previous_snapshot: row.previous_snapshot ? parseDbObject(row.previous_snapshot) : null,
  snapshot: parseDbObject(row.snapshot),
});
const parseJsonArray = (value: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
};
const parseRoute = (pathname: string): Route | Response => {
  if (!pathname.startsWith(PREFIX + '/')) return fail('NOT_FOUND', 404);
  const tail = pathname.slice(PREFIX.length + 1).split('/');
  if (!tail[0] || tail.length > 2) return fail('INVALID_DECLARATION_ID', 400);
  let declarationId: string;
  try { declarationId = decodeURIComponent(tail[0]); }
  catch { return fail('INVALID_DECLARATION_ID', 400); }
  if (!declarationId || declarationId.length > 128 || declarationId.includes('/')) {
    return fail('INVALID_DECLARATION_ID', 400);
  }
  const suffix = tail[1];
  const action: RouteAction = suffix === undefined ? 'read'
    : suffix === 'events' ? 'events'
      : suffix === 'activity' ? 'activity'
        : suffix === 'complete' ? 'complete'
          : suffix === 'rollback' ? 'rollback' : 'read';
  if (suffix !== undefined && !['events', 'activity', 'complete', 'rollback'].includes(suffix)) {
    return fail('NOT_FOUND', 404);
  }
  return { declarationId, action };
};
const readBody = async (request: Request): Promise<JsonObject | Response> => {
  if (Number(request.headers.get('content-length') || 0) > 64 * 1024) return fail('REQUEST_TOO_LARGE', 413);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 64 * 1024) return fail('REQUEST_TOO_LARGE', 413);
    const value: unknown = JSON.parse(raw);
    return isObject(value) ? value : fail('INVALID_JSON', 400);
  } catch { return fail('INVALID_JSON', 400); }
};
const timestampAfter = (value: string) => {
  const previous = Date.parse(value);
  return new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)).toISOString();
};
const parseDeclaration = async (
  db: CustomsWorkflowD1Database,
  declarationId: string,
  organizationId: string,
) => db.prepare(
  'SELECT d.id,d.organization_id,d.shipment_id,d.customs_path,d.customs_regime,' +
  'sc.vessel_type,sc.cargo_description,sc.tariff_code,sc.sata_code ' +
  'FROM customs_declarations d LEFT JOIN shipment_customs_data sc ' +
  'ON sc.shipment_id=d.shipment_id AND sc.organization_id=d.organization_id ' +
  'WHERE d.id=? AND d.organization_id=? LIMIT 1',
).bind(declarationId, organizationId).first<DeclarationRow>();
const getWorkflow = (db: CustomsWorkflowD1Database, declarationId: string, organizationId: string) =>
  db.prepare(
    'SELECT * FROM customs_declaration_workflow WHERE declaration_id=? AND organization_id=? LIMIT 1',
  ).bind(declarationId, organizationId).first<WorkflowDbRow>();
const getEvents = (db: CustomsWorkflowD1Database, declarationId: string, organizationId: string) =>
  db.prepare(
    'SELECT id,organization_id,declaration_id,workflow_id,event_type,previous_stage,current_stage,' +
    'changed_fields,previous_snapshot,snapshot,actor_id,created_at FROM customs_declaration_workflow_events ' +
    'WHERE declaration_id=? AND organization_id=? ORDER BY created_at DESC,id DESC LIMIT 10',
  ).bind(declarationId, organizationId).all<WorkflowEventDbRow>();

const makeDefaults = (declaration: DeclarationRow) => {
  const description = (declaration.cargo_description || '').toLowerCase();
  const tariff = String(declaration.tariff_code || '').replace(/[^0-9]/g, '');
  const foreign = /خارج|foreign|international/i.test(declaration.vessel_type || '');
  const quarantine = /چوب|تخته نراد|نراد|ذرت|جو|گندم|غلات|چوب خام|wood|lumber|barley|wheat|corn|grain/i.test(description)
    || /^(44|10|12)/.test(tariff);
  const standard = /ورق آهن|ورق فولاد|ورق فولادی|فولاد|آهن|steel sheet|iron sheet/i.test(description)
    || /^72/.test(tariff);
  return {
    evaluation: { ...DEFAULTS.evaluation, status: declaration.customs_path === 'red' ? 'required' : 'not_required' },
    expertise: {
      ...DEFAULTS.expertise,
      road_authority_status: foreign ? 'pending' : 'not_required',
      plant_quarantine_status: quarantine ? 'pending' : 'not_required',
      standard: {
        ...DEFAULTS.expertise.standard,
        expert_review: standard ? 'pending' : 'not_required',
        inspection_status: standard ? 'not_requested' : 'not_required',
      },
    },
    cashier: { ...DEFAULTS.cashier },
    loadingPermit: { ...DEFAULTS.loadingPermit, sata_code: declaration.sata_code || '' },
    exit: { ...DEFAULTS.exit },
    port: { ...DEFAULTS.port },
  };
};
const jsonText = (value: unknown) => JSON.stringify(value);
const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const a = Object.keys(left).sort(), b = Object.keys(right).sort();
  return a.length === b.length && a.every((key, index) => key === b[index] && deepEqual(left[key], right[key]));
};
const mergePatch = (current: JsonObject, patch: JsonObject): JsonObject => {
  const result = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isObject(result[key]) && isObject(value)
      ? mergePatch(result[key] as JsonObject, value)
      : value;
  }
  return result;
};
const collectConflicts = (
  current: JsonObject,
  base: JsonObject,
  patch: JsonObject,
  prefix = '',
): string[] => {
  const conflicts: string[] = [];
  for (const [key, patchValue] of Object.entries(patch)) {
    const path = prefix ? prefix + '.' + key : key;
    const currentHas = Object.prototype.hasOwnProperty.call(current, key);
    const baseHas = Object.prototype.hasOwnProperty.call(base, key);
    const currentValue = current[key], baseValue = base[key];
    if (isObject(patchValue) && isObject(baseValue) && isObject(currentValue)) {
      conflicts.push(...collectConflicts(currentValue, baseValue, patchValue, path));
      continue;
    }
    if (currentHas !== baseHas && !(currentHas && deepEqual(currentValue, patchValue))) {
      conflicts.push(path);
    } else if (!deepEqual(currentValue, baseValue) && !deepEqual(currentValue, patchValue)) {
      conflicts.push(path);
    }
  }
  return conflicts;
};
const undoPatch = (current: unknown, before: unknown, after: unknown): unknown => {
  if (!isObject(current) || !isObject(before) || !isObject(after)) {
    return deepEqual(current, after) ? before : current;
  }
  const result = { ...current };
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const beforeHas = Object.prototype.hasOwnProperty.call(before, key);
    const afterHas = Object.prototype.hasOwnProperty.call(after, key);
    const currentHas = Object.prototype.hasOwnProperty.call(result, key);
    const beforeValue = before[key], afterValue = after[key], currentValue = result[key];
    if (beforeHas && afterHas && isObject(beforeValue) && isObject(afterValue) && currentHas && isObject(currentValue)) {
      result[key] = undoPatch(currentValue, beforeValue, afterValue);
    } else if (currentHas === afterHas && (!afterHas || deepEqual(currentValue, afterValue))) {
      if (beforeHas) result[key] = beforeValue;
      else delete result[key];
    }
  }
  return result;
};
const validatePatch = (activity: string, patch: JsonObject): activity is Activity => {
  if (!Object.keys(patch).length) return false;
  if (activity === 'abandoned') return Object.keys(patch).every(key => key === 'notes');
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_FIELDS, activity)) return false;
  const allowed = ALLOWED_FIELDS[activity as Exclude<Activity, 'abandoned'>];
  if (Object.keys(patch).some(key => !allowed.includes(key))) return false;
  if (activity === 'expertise' && patch.standard !== undefined) {
    if (!isObject(patch.standard) || Object.keys(patch.standard).some(key => !STANDARD_FIELDS.has(key))) return false;
  }
  return true;
};
const writeUpdate = async (
  db: CustomsWorkflowD1Database,
  sql: string,
  values: unknown[],
  sataMirror?: { declarationId: string; organizationId: string; sataCode: string },
) => {
  if (sataMirror) {
    const results = await db.batch([
      db.prepare(sql).bind(...values),
      db.prepare(
        'INSERT INTO shipment_customs_data (shipment_id,organization_id,sata_code) ' +
        'SELECT d.shipment_id,d.organization_id,? FROM customs_declarations d ' +
        'WHERE d.id=? AND d.organization_id=? AND changes()>0 ' +
        'ON CONFLICT(shipment_id) DO UPDATE SET sata_code=excluded.sata_code,organization_id=excluded.organization_id',
      ).bind(sataMirror.sataCode || null, sataMirror.declarationId, sataMirror.organizationId),
    ]);
    const first = results[0] as { meta?: { changes?: number } } | undefined;
    return Number(first?.meta?.changes || 0);
  }
  const result = await db.prepare(sql).bind(...values).run();
  return Number(result.meta?.changes || 0);
};

export const handleCustomsDeclarationWorkflowApi = async (
  request: Request,
  db: CustomsWorkflowD1Database,
  url: URL,
  profile: CustomsWorkflowProfile,
): Promise<Response> => {
  if (!profile.is_active || !READ_ROLES.has(profile.role)) return fail('FORBIDDEN', 403);
  if (!profile.id || !profile.organization_id) return fail('INVALID_SESSION_PROFILE', 401);
  const route = parseRoute(url.pathname);
  if (route instanceof Response) return route;
  const { declarationId, action } = route;

  if (request.method === 'GET' && action === 'read') {
    try {
      const declaration = await parseDeclaration(db, declarationId, profile.organization_id);
      if (!declaration) return fail('DECLARATION_NOT_FOUND', 404);
      const row = await getWorkflow(db, declarationId, profile.organization_id);
      return json({
        ok: true,
        declaration: {
          id: declaration.id,
          shipment_id: declaration.shipment_id,
          customs_path: declaration.customs_path,
          customs_regime: declaration.customs_regime,
          vessel_type: declaration.vessel_type,
          cargo_description: declaration.cargo_description,
          tariff_code: declaration.tariff_code,
          sata_code: declaration.sata_code,
        },
        workflow: row ? parseRow(row) : null,
      });
    } catch { return fail('CUSTOMS_WORKFLOW_API_NOT_READY', 503); }
  }

  if (request.method === 'GET' && action === 'events') {
    try {
      const declaration = await parseDeclaration(db, declarationId, profile.organization_id);
      if (!declaration) return fail('DECLARATION_NOT_FOUND', 404);
      const events = await getEvents(db, declarationId, profile.organization_id);
      return json({ ok: true, events: events.results.map(parseEvent) });
    } catch { return fail('CUSTOMS_WORKFLOW_HISTORY_NOT_READY', 503); }
  }

  if (request.method !== 'POST' && request.method !== 'PATCH') {
    return fail('METHOD_NOT_ALLOWED', 405, {
      allowed: action === 'read' ? ['GET', 'POST'] : action === 'events' ? ['GET'] : ['PATCH', 'POST'],
    });
  }
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  if (!WRITE_ROLES.has(profile.role)) return fail('FORBIDDEN', 403);

  if (action === 'read' && request.method === 'POST') {
    const declaration = await parseDeclaration(db, declarationId, profile.organization_id).catch(() => null);
    if (!declaration) return fail('DECLARATION_NOT_FOUND', 404);
    if (declaration.customs_regime !== 'import_definitive') {
      return fail('WORKFLOW_NOT_APPLICABLE', 409, { customsRegime: declaration.customs_regime });
    }
    const initial = makeDefaults(declaration);
    const now = new Date().toISOString();
    try {
      await db.prepare(
        'INSERT OR IGNORE INTO customs_declaration_workflow (' +
        'id,organization_id,declaration_id,current_stage,evaluation_state,expertise_state,cashier_state,' +
        'loading_permit_state,exit_state,port_charges_state,procedure_state,created_by,updated_by,created_at,updated_at' +
        ') VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        crypto.randomUUID(), profile.organization_id, declarationId, 'evaluation',
        jsonText(initial.evaluation), jsonText(initial.expertise), jsonText(initial.cashier),
        jsonText(initial.loadingPermit), jsonText(initial.exit), jsonText(initial.port),
        '{}', profile.id, profile.id, now, now,
      ).run();
      const row = await getWorkflow(db, declarationId, profile.organization_id);
      if (!row) return fail('CUSTOMS_WORKFLOW_CREATE_NOT_CONFIRMED', 500);
      return json({ ok: true, workflow: parseRow(row) }, 201);
    } catch { return fail('CUSTOMS_WORKFLOW_CREATE_FAILED', 500); }
  }

  if (action === 'activity' && request.method === 'PATCH') {
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const activity = typeof body.activity === 'string' ? body.activity : '';
    const patch = parseJsonObject(body.patch);
    const baseState = parseJsonObject(body.baseState);
    const expectedStage = typeof body.expectedCurrentStage === 'string' ? body.expectedCurrentStage : '';
    if (!patch || !validatePatch(activity, patch)) return fail('INVALID_WORKFLOW_PATCH', 422);
    if (!baseState) return fail('WORKFLOW_BASELINE_REQUIRED', 422);
    const row = await getWorkflow(db, declarationId, profile.organization_id).catch(() => null);
    if (!row) return fail('WORKFLOW_NOT_FOUND', 404);
    const current = activity === 'abandoned'
      ? { notes: row.notes }
      : parseDbObject(row[STATE_COLUMNS[activity as Exclude<Activity, 'abandoned'>]]);
    const conflicts = collectConflicts(current, baseState, patch);
    if (conflicts.length) return fail('CUSTOMS_WORKFLOW_CONFLICT', 409, { conflicts });
    const merged = activity === 'abandoned' ? null : mergePatch(current, patch);
    const nextStage = row.current_stage === expectedStage ? activity : row.current_stage;
    const updatedAt = timestampAfter(row.updated_at);
    const sets: string[] = [];
    const values: unknown[] = [];
    if (activity === 'abandoned') {
      sets.push('notes=?'); values.push(typeof patch.notes === 'string' && patch.notes.trim() ? patch.notes.trim() : null);
    } else {
      sets.push(STATE_COLUMNS[activity as Exclude<Activity, 'abandoned'>] + '=?');
      values.push(jsonText(merged));
    }
    sets.push('current_stage=?','updated_by=?','updated_at=?','last_event_type=?');
    values.push(nextStage, profile.id, updatedAt, 'saved', row.id, profile.organization_id, row.updated_at);
    const sataMirror = activity === 'loading_permit' && Object.prototype.hasOwnProperty.call(patch, 'sata_code')
      ? { declarationId, organizationId: profile.organization_id, sataCode: String(patch.sata_code ?? '').trim() }
      : undefined;
    try {
      const changes = await writeUpdate(
        db,
        'UPDATE customs_declaration_workflow SET ' + sets.join(', ') +
          ' WHERE id=? AND organization_id=? AND updated_at=?',
        values,
        sataMirror,
      );
      if (changes !== 1) return fail('CUSTOMS_WORKFLOW_CONFLICT', 409);
      const saved = await getWorkflow(db, declarationId, profile.organization_id);
      return saved ? json({ ok: true, workflow: parseRow(saved) }) : fail('WORKFLOW_UPDATE_NOT_CONFIRMED', 500);
    } catch { return fail('CUSTOMS_WORKFLOW_SAVE_FAILED', 500); }
  }

  if (action === 'complete' && request.method === 'POST') {
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const row = await getWorkflow(db, declarationId, profile.organization_id).catch(() => null);
    if (!row) return fail('WORKFLOW_NOT_FOUND', 404);
    const declaration = await parseDeclaration(db, declarationId, profile.organization_id).catch(() => null);
    if (!declaration) return fail('DECLARATION_NOT_FOUND', 404);
    const states = parseRow(row);
    const state: CustomsWorkflowValidationState = {
      customsPath: declaration.customs_path || '',
      evaluation: states.evaluation_state,
      expertise: states.expertise_state,
      cashier: states.cashier_state,
      loadingPermit: states.loading_permit_state,
      exit: states.exit_state,
      port: states.port_charges_state,
    };
    const issues = getWorkflowStageIssues('evaluation', state).concat(
      getWorkflowStageIssues('expertise', state),
      getWorkflowStageIssues('cashier', state),
      getWorkflowStageIssues('loading_permit', state),
      getWorkflowStageIssues('exit', state),
      getWorkflowStageIssues('port_charges', state),
    );
    if (issues.length) return json({ ok: true, ready: false, issues });
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    const updatedAt = timestampAfter(row.updated_at);
    try {
      const changes = await writeUpdate(
        db,
        'UPDATE customs_declaration_workflow SET current_stage=?,notes=?,updated_by=?,updated_at=?,last_event_type=? ' +
        'WHERE id=? AND organization_id=? AND updated_at=?',
        ['completed', notes, profile.id, updatedAt, 'saved', row.id, profile.organization_id, row.updated_at],
      );
      if (changes !== 1) return fail('CUSTOMS_WORKFLOW_CONFLICT', 409);
      const saved = await getWorkflow(db, declarationId, profile.organization_id);
      return saved ? json({ ok: true, ready: true, workflow: parseRow(saved) }) : fail('WORKFLOW_UPDATE_NOT_CONFIRMED', 500);
    } catch { return fail('CUSTOMS_WORKFLOW_COMPLETE_FAILED', 500); }
  }

  if (action === 'rollback' && request.method === 'POST') {
    const row = await getWorkflow(db, declarationId, profile.organization_id).catch(() => null);
    if (!row) return fail('WORKFLOW_NOT_FOUND', 404);
    try {
      const latest = await db.prepare(
        'SELECT id,event_type,previous_stage,current_stage,changed_fields,previous_snapshot,snapshot ' +
        'FROM customs_declaration_workflow_events WHERE workflow_id=? AND organization_id=? ' +
        'ORDER BY created_at DESC,id DESC LIMIT 1',
      ).bind(row.id, profile.organization_id).first<WorkflowEventDbRow>();
      if (!latest || latest.event_type === 'created' || latest.event_type === 'rollback' || !latest.previous_snapshot) {
        return fail('WORKFLOW_NO_REVERSIBLE_CHANGE', 409);
      }
      const previous = parseDbObject(latest.previous_snapshot);
      const after = parseDbObject(latest.snapshot);
      const changed = parseJsonArray(latest.changed_fields);
      const parsed = parseRow(row);
      const sets: string[] = [];
      const values: unknown[] = [];
      if (changed.includes('current_stage') && row.current_stage === latest.current_stage) {
        sets.push('current_stage=?'); values.push(latest.previous_stage || row.current_stage);
      }
      const statePairs = [
        ['evaluation_state', 'evaluation_state'], ['expertise_state', 'expertise_state'],
        ['cashier_state', 'cashier_state'], ['loading_permit_state', 'loading_permit_state'],
        ['exit_state', 'exit_state'], ['port_charges_state', 'port_charges_state'],
        ['procedure_state', 'procedure_state'],
      ] as const;
      for (const [field, rowField] of statePairs) {
        if (!changed.includes(field)) continue;
        const next = undoPatch(parsed[rowField], previous[field], after[field]);
        if (!deepEqual(next, parsed[rowField])) {
          sets.push(field + '=?'); values.push(jsonText(next));
        }
      }
      if (changed.includes('notes') && deepEqual(row.notes, after.notes)) {
        sets.push('notes=?'); values.push(previous.notes ?? null);
      }
      if (!sets.length) return fail('WORKFLOW_NO_REVERSIBLE_CHANGE', 409);
      const updatedAt = timestampAfter(row.updated_at);
      sets.push('updated_by=?','updated_at=?','last_event_type=?');
      values.push(profile.id, updatedAt, 'rollback', row.id, profile.organization_id, row.updated_at);
      const changes = await writeUpdate(
        db,
        'UPDATE customs_declaration_workflow SET ' + sets.join(', ') +
          ' WHERE id=? AND organization_id=? AND updated_at=?',
        values,
      );
      if (changes !== 1) return fail('CUSTOMS_WORKFLOW_CONFLICT', 409);
      const saved = await getWorkflow(db, declarationId, profile.organization_id);
      return saved ? json({ ok: true, workflow: parseRow(saved) }) : fail('WORKFLOW_UPDATE_NOT_CONFIRMED', 500);
    } catch { return fail('CUSTOMS_WORKFLOW_ROLLBACK_FAILED', 500); }
  }

  return fail('NOT_FOUND', 404);
};

export const customsWorkflowMergePatch = mergePatch;
export const customsWorkflowCollectConflicts = collectConflicts;
export const customsWorkflowUndoPatch = undoPatch;
export const customsWorkflowDefaults = makeDefaults;
