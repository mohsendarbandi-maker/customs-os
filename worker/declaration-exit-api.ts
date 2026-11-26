import {
  getWorkflowStageIssues,
  type CustomsWorkflowValidationState,
} from '../supabase/functions/_shared/customsDeclarationWorkflow';

export interface DeclarationExitD1Statement {
  bind(...values: unknown[]): DeclarationExitD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface DeclarationExitD1Database {
  prepare(sql: string): DeclarationExitD1Statement;
  batch(statements: DeclarationExitD1Statement[]): Promise<unknown[]>;
}
export interface DeclarationExitProfile {
  id: string;
  organization_id: string;
  role: string;
  is_active: boolean;
}

type JsonObject = Record<string, unknown>;
type ExitKey =
  | 'warehouse_invoice_initial'
  | 'warehouse_invoice_supplement'
  | 'transport_power_of_attorney';

interface DeclarationRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  shipment_id: string | null;
  linked_shipment_id: string | null;
  case_id: string | null;
  kottaj_number: string;
  customs_regime: string | null;
  customs_path: string | null;
  workflow_stage: number | null;
  finance_status: string | null;
  tariff_code: string | null;
  cargo_description: string | null;
  sata_code: string | null;
  ship_passed: number | boolean | null;
  transport_documents_status: string | null;
  transport_mode: string | null;
  warehouse_receipt_no: string | null;
}
interface WorkflowRow extends Record<string, unknown> {
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
  updated_at: string;
}
interface ChecklistRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  declaration_id: string;
  item_key: string;
  item_label: string;
  completed: number | boolean;
  note: string | null;
  sort_order: number;
  source: string;
  is_active: number | boolean;
  completed_at: string | null;
  completed_by: string | null;
  updated_at: string;
}
interface ExitChecklistRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  declaration_id: string;
  item_key: ExitKey;
  completed: number | boolean;
  completed_at: string | null;
  completed_by: string | null;
}
interface RuleRow extends Record<string, unknown> {
  id: string;
  evidence_count: number;
  source: string;
  confidence: number;
}
interface LearningEventRow extends Record<string, unknown> {
  id: string;
  declaration_id: string;
}

const PREFIX = '/api/declarations';
const READ_ROLES = new Set(['owner', 'admin', 'broker', 'accountant', 'warehouse']);
const WRITE_ROLES = new Set(['owner', 'admin', 'broker', 'warehouse']);
const EXIT_ITEMS: Array<{ key: ExitKey; label: string }> = [
  { key: 'warehouse_invoice_initial', label: 'صورت‌حساب انبارداری اولیه' },
  { key: 'warehouse_invoice_supplement', label: 'صورت‌حساب انبارداری متمم' },
  { key: 'transport_power_of_attorney', label: 'وکالت حمل' },
];
const STANDARD_ITEMS = [
  'مالیات علی الحساب',
  'درخواست ضمانتنامه حقوق ورودی و ارزش افزوده',
  'ارزیابی',
  'آزمایشگاه',
  'مجوز استاندارد',
  'نوبت کارشناسی',
  'کد ساتا',
  'تبصره دو منطقه آزاد',
] as const;
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
const parseObject = (value: unknown): JsonObject => {
  if (isObject(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch { return {}; }
};
const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
};
const boundedText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
};
const bodyObject = async (request: Request): Promise<JsonObject | Response> => {
  if (Number(request.headers.get('content-length') || 0) > 64 * 1024) return fail('REQUEST_TOO_LARGE', 413);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 64 * 1024) return fail('REQUEST_TOO_LARGE', 413);
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? parsed : fail('INVALID_JSON', 400);
  } catch { return fail('INVALID_JSON', 400); }
};
const parseRoute = (pathname: string): { declarationId: string; action: string; itemId?: string } | Response => {
  if (!pathname.startsWith(PREFIX + '/')) return fail('NOT_FOUND', 404);
  const parts = pathname.slice(PREFIX.length + 1).split('/');
  if (parts.length < 2 || parts.length > 4 || parts[1] !== 'exit') return fail('NOT_FOUND', 404);
  let declarationId = '';
  try { declarationId = decodeURIComponent(parts[0]); } catch { return fail('INVALID_DECLARATION_ID', 400); }
  if (!declarationId || declarationId.length > 128 || declarationId.includes('/')) return fail('INVALID_DECLARATION_ID', 400);
  if (parts.length === 2) return { declarationId, action: 'read' };
  if (parts.length === 3 && ['checklist', 'items', 'advance', 'complete'].includes(parts[2])) {
    return { declarationId, action: parts[2] };
  }
  if (parts.length === 4 && parts[2] === 'items') {
    let itemId = '';
    try { itemId = decodeURIComponent(parts[3]); } catch { return fail('INVALID_ITEM_ID', 400); }
    if (!itemId || itemId.length > 128 || itemId.includes('/')) return fail('INVALID_ITEM_ID', 400);
    return { declarationId, action: 'item', itemId };
  }
  return fail('NOT_FOUND', 404);
};
const getDeclaration = (db: DeclarationExitD1Database, id: string, organizationId: string) =>
  db.prepare(
    'SELECT d.id,d.organization_id,d.case_id,d.shipment_id,d.kottaj_number,d.customs_regime,' +
    'd.customs_path,d.workflow_stage,sc.tariff_code,sc.cargo_description,sc.sata_code,' +
    's.id AS linked_shipment_id,s.ship_passed,s.transport_documents_status,s.transport_mode,s.finance_status,c.warehouse_receipt_no ' +
    'FROM customs_declarations d ' +
    'LEFT JOIN shipments s ON s.id=d.shipment_id AND s.organization_id=d.organization_id ' +
    'LEFT JOIN shipment_customs_data sc ON sc.shipment_id=d.shipment_id AND sc.organization_id=d.organization_id ' +
    'LEFT JOIN cases c ON c.id=d.case_id AND c.organization_id=d.organization_id ' +
    'WHERE d.id=? AND d.organization_id=? LIMIT 1',
  ).bind(id, organizationId).first<DeclarationRow>();
const getWorkflow = (db: DeclarationExitD1Database, declarationId: string, organizationId: string) =>
  db.prepare(
    'SELECT * FROM customs_declaration_workflow WHERE declaration_id=? AND organization_id=? LIMIT 1',
  ).bind(declarationId, organizationId).first<WorkflowRow>();
const readChecklist = (db: DeclarationExitD1Database, declarationId: string, organizationId: string) =>
  db.prepare(
    'SELECT id,organization_id,declaration_id,item_key,item_label,completed,completed_at,completed_by,note,sort_order,source,is_active,updated_at ' +
    'FROM declaration_checklist_items WHERE declaration_id=? AND organization_id=? ' +
    'ORDER BY sort_order,created_at,id',
  ).bind(declarationId, organizationId).all<ChecklistRow>();
const readExitChecklist = (db: DeclarationExitD1Database, declarationId: string, organizationId: string) =>
  db.prepare(
    'SELECT id,organization_id,declaration_id,item_key,completed,completed_at,completed_by ' +
    'FROM declaration_exit_checklist_items WHERE declaration_id=? AND organization_id=? ORDER BY item_key',
  ).bind(declarationId, organizationId).all<ExitChecklistRow>();
const ensureChecklist = async (db: DeclarationExitD1Database, declaration: DeclarationRow) => {
  const now = new Date().toISOString();
  const statements: DeclarationExitD1Statement[] = [];
  STANDARD_ITEMS.forEach((label, index) => {
    statements.push(db.prepare(
      'INSERT OR IGNORE INTO declaration_checklist_items ' +
      '(id,organization_id,declaration_id,item_key,item_label,completed,sort_order,source,is_active,created_at,updated_at) ' +
      'VALUES (?,?,?,?,?,0,?,\'system\',1,?,?)',
    ).bind(crypto.randomUUID(), declaration.organization_id, declaration.id, label, label, (index + 1) * 10, now, now));
  });
  EXIT_ITEMS.forEach(item => {
    statements.push(db.prepare(
      'INSERT OR IGNORE INTO declaration_exit_checklist_items ' +
      '(id,organization_id,declaration_id,item_key,completed,created_at,updated_at) VALUES (?,?,?,?,0,?,?)',
    ).bind(crypto.randomUUID(), declaration.organization_id, declaration.id, item.key, now, now));
  });
  await db.batch(statements);
};
const insertAudit = (
  db: DeclarationExitD1Database,
  profile: DeclarationExitProfile,
  action: 'create' | 'update' | 'delete',
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  requestId: string,
) => db.prepare(
  'INSERT INTO customs_os_audit_events ' +
  '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
  'VALUES (?,?,?,?,?,?,?,?,?)',
).bind(
  crypto.randomUUID(), profile.organization_id, profile.id, action, entityType, entityId,
  before == null ? null : JSON.stringify(before),
  after == null ? null : JSON.stringify(after),
  requestId.slice(0, 180),
);
const boolInt = (value: unknown) => value === true || value === 1 || value === '1' ? 1 : 0;
const stageIssue = (declaration: DeclarationRow, workflow: WorkflowRow | null) => {
  if (!workflow) return ['گردش‌کار گمرکی برای اظهارنامه ایجاد نشده است.'];
  const state: CustomsWorkflowValidationState = {
    customsPath: declaration.customs_path || '',
    evaluation: parseObject(workflow.evaluation_state),
    expertise: parseObject(workflow.expertise_state),
    cashier: parseObject(workflow.cashier_state),
    loadingPermit: parseObject(workflow.loading_permit_state),
    exit: parseObject(workflow.exit_state),
    port: parseObject(workflow.port_charges_state),
  };
  return [
    ...getWorkflowStageIssues('evaluation', state),
    ...getWorkflowStageIssues('expertise', state),
    ...getWorkflowStageIssues('cashier', state),
    ...getWorkflowStageIssues('loading_permit', state),
    ...getWorkflowStageIssues('exit', state),
    ...getWorkflowStageIssues('port_charges', state),
  ];
};
const remainingItems = (rows: ChecklistRow[]) => rows
  .filter(row => boolInt(row.is_active) === 1 && boolInt(row.completed) === 0)
  .map(row => row.item_label || row.item_key);

const recordLearning = async (
  db: DeclarationExitD1Database,
  profile: DeclarationExitProfile,
  declaration: DeclarationRow,
) => {
  const hsCode = String(declaration.tariff_code || '').replace(/[^0-9]/g, '');
  if (!hsCode) return null;
  const checklist = await readChecklist(db, declaration.id, profile.organization_id);
  const snapshot = checklist.results
    .filter(row => boolInt(row.is_active) === 1)
    .map(row => row.item_label || row.item_key);
  const fields = {
    tariff_code: hsCode,
    customs_path: declaration.customs_path || '',
    kottaj_number: declaration.kottaj_number,
    warehouse_receipt_no: declaration.warehouse_receipt_no,
    cargo_description: declaration.cargo_description,
    sata_code: declaration.sata_code,
  };
  const existing = await db.prepare(
    'SELECT id FROM customs_operation_learning_events WHERE declaration_id=? AND organization_id=? LIMIT 1',
  ).bind(declaration.id, profile.organization_id).first<LearningEventRow>();
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO customs_operation_learning_events ' +
    '(id,organization_id,declaration_id,shipment_id,hs_code,customs_path,checklist_snapshot,field_snapshot,workflow_stages,created_by,created_at) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?) ' +
    'ON CONFLICT(declaration_id) DO UPDATE SET shipment_id=excluded.shipment_id,hs_code=excluded.hs_code,' +
    'customs_path=excluded.customs_path,checklist_snapshot=excluded.checklist_snapshot,' +
    'field_snapshot=excluded.field_snapshot,workflow_stages=excluded.workflow_stages',
  ).bind(
    existing?.id || crypto.randomUUID(), profile.organization_id, declaration.id, declaration.shipment_id,
    hsCode, declaration.customs_path || '', JSON.stringify(snapshot), JSON.stringify(fields),
    JSON.stringify([4, 6]), profile.id, now,
  ).run();
  const evidence = await db.prepare(
    'SELECT COUNT(*) AS total FROM customs_operation_learning_events ' +
    'WHERE organization_id=? AND hs_code=? AND customs_path=?',
  ).bind(profile.organization_id, hsCode, declaration.customs_path || '').first<{ total: number }>();
  const events = await db.prepare(
    'SELECT checklist_snapshot,field_snapshot FROM customs_operation_learning_events ' +
    'WHERE organization_id=? AND hs_code=? AND customs_path=?',
  ).bind(profile.organization_id, hsCode, declaration.customs_path || '').all<{ checklist_snapshot: string; field_snapshot: string }>();
  const checklistCounts: Record<string, number> = {};
  const fieldCounts: Record<string, number> = {};
  for (const event of events.results) {
    let parsedItems: unknown = [];
    let parsedFields: unknown = {};
    try { parsedItems = JSON.parse(event.checklist_snapshot); } catch { parsedItems = []; }
    try { parsedFields = JSON.parse(event.field_snapshot); } catch { parsedFields = {}; }
    if (Array.isArray(parsedItems)) {
      for (const value of parsedItems) if (typeof value === 'string') checklistCounts[value] = (checklistCounts[value] || 0) + 1;
    }
    if (isObject(parsedFields)) {
      for (const [key, value] of Object.entries(parsedFields)) {
        if (value != null && String(value).trim() !== '') fieldCounts[key] = (fieldCounts[key] || 0) + 1;
      }
    }
  }
  const currentRule = await db.prepare(
    'SELECT id,evidence_count,source,confidence FROM customs_operation_rules ' +
    'WHERE organization_id=? AND hs_code_prefix=? AND customs_path=? AND transport_mode=? LIMIT 1',
  ).bind(profile.organization_id, hsCode, declaration.customs_path || '', declaration.transport_mode || 'sea').first<RuleRow>();
  const total = Number(evidence?.total || 0);
  const confidence = Math.min(0.98, 0.45 + (0.15 * total));
  if (!currentRule) {
    await db.prepare(
      'INSERT INTO customs_operation_rules ' +
      '(id,organization_id,rule_name,hs_code_prefix,customs_path,transport_mode,checklist_counts,field_counts,' +
      'workflow_stages,evidence_count,confidence,source,is_active,created_by,updated_by,created_at,updated_at) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,\'learned\',?,?,?,?,?)',
    ).bind(
      crypto.randomUUID(), profile.organization_id, 'یادگیری عملیات — HS ' + hsCode, hsCode,
      declaration.customs_path || '', declaration.transport_mode || 'sea',
      JSON.stringify(checklistCounts), JSON.stringify(fieldCounts), JSON.stringify([4, 6]),
      total, confidence, total >= 2 ? 1 : 0, profile.id, profile.id, now, now,
    ).run();
  } else {
    const isNewEvent = !existing;
    await db.prepare(
      'UPDATE customs_operation_rules SET checklist_counts=?,field_counts=?,evidence_count=?,' +
      'confidence=?,source=\'learned\',is_active=?,updated_by=?,updated_at=? WHERE id=? AND organization_id=?',
    ).bind(
      JSON.stringify(checklistCounts), JSON.stringify(fieldCounts),
      isNewEvent ? total : Number(currentRule.evidence_count || total),
      isNewEvent ? confidence : Number(currentRule.confidence || confidence),
      total >= 2 ? 1 : 0, profile.id, now, currentRule.id, profile.organization_id,
    ).run();
  }
  return { hsCode, evidenceCount: total, confidence, active: total >= 2 };
};

const handleRead = async (
  db: DeclarationExitD1Database,
  declaration: DeclarationRow,
  profile: DeclarationExitProfile,
) => {
  await ensureChecklist(db, declaration);
  const [checklist, exitChecklist, workflow] = await Promise.all([
    readChecklist(db, declaration.id, profile.organization_id),
    readExitChecklist(db, declaration.id, profile.organization_id),
    getWorkflow(db, declaration.id, profile.organization_id),
  ]);
  const done = new Map(exitChecklist.results.map(row => [row.item_key, boolInt(row.completed) === 1]));
  return json({
    ok: true,
    declaration,
    workflow: workflow ? {
      ...workflow,
      evaluation_state: parseObject(workflow.evaluation_state),
      expertise_state: parseObject(workflow.expertise_state),
      cashier_state: parseObject(workflow.cashier_state),
      loading_permit_state: parseObject(workflow.loading_permit_state),
      exit_state: parseObject(workflow.exit_state),
      port_charges_state: parseObject(workflow.port_charges_state),
      procedure_state: parseObject(workflow.procedure_state),
    } : null,
    exitItems: EXIT_ITEMS.map(item => ({ ...item, completed: Boolean(done.get(item.key)) })),
    checklistItems: checklist.results.map(row => ({ ...row, completed: boolInt(row.completed) === 1, is_active: boolInt(row.is_active) === 1 })),
    remainingChecklistItems: remainingItems(checklist.results),
  });
};

const updateExitItem = async (
  request: Request,
  db: DeclarationExitD1Database,
  declaration: DeclarationRow,
  profile: DeclarationExitProfile,
  requestId: string,
) => {
  const body = await bodyObject(request);
  if (body instanceof Response) return body;
  const key = boundedText(body.item_key, 80);
  if (!key || !EXIT_ITEMS.some(item => item.key === key)) return fail('INVALID_EXIT_CHECKLIST_ITEM', 422);
  if (typeof body.completed !== 'boolean') return fail('INVALID_COMPLETED_VALUE', 422);
  const before = await db.prepare(
    'SELECT id,item_key,completed,completed_at,completed_by FROM declaration_exit_checklist_items ' +
    'WHERE declaration_id=? AND organization_id=? AND item_key=? LIMIT 1',
  ).bind(declaration.id, profile.organization_id, key).first<ExitChecklistRow>();
  const now = new Date().toISOString();
  const id = before?.id || crypto.randomUUID();
  const after = {
    id, item_key: key, completed: body.completed,
    completed_at: body.completed ? now : null,
    completed_by: body.completed ? profile.id : null,
  };
  await db.batch([
    db.prepare(
      'INSERT INTO declaration_exit_checklist_items ' +
      '(id,organization_id,declaration_id,item_key,completed,completed_at,completed_by,created_at,updated_at) ' +
      'VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(declaration_id,item_key) DO UPDATE SET ' +
      'completed=excluded.completed,completed_at=excluded.completed_at,completed_by=excluded.completed_by,updated_at=excluded.updated_at',
    ).bind(id, profile.organization_id, declaration.id, key, body.completed ? 1 : 0,
      after.completed_at, after.completed_by, now, now),
    insertAudit(db, profile, before ? 'update' : 'create', 'declaration_exit_checklist_item', id, before, after, requestId),
  ]);
  return json({ ok: true, item: after });
};

const createChecklistItem = async (
  request: Request,
  db: DeclarationExitD1Database,
  declaration: DeclarationRow,
  profile: DeclarationExitProfile,
  requestId: string,
) => {
  const body = await bodyObject(request);
  if (body instanceof Response) return body;
  const label = boundedText(body.item_label, 500);
  if (!label || label.length < 2) return fail('INVALID_CHECKLIST_LABEL', 422);
  const sortOrder = Number.isSafeInteger(body.sort_order) && Number(body.sort_order) >= 1
    ? Math.min(Number(body.sort_order), 10000) : 1000;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const after = {
    id, organization_id: profile.organization_id, declaration_id: declaration.id,
    item_key: crypto.randomUUID(), item_label: label, completed: false, note: null,
    sort_order: sortOrder, source: 'manual', is_active: true,
  };
  try {
    await db.batch([
      db.prepare(
        'INSERT INTO declaration_checklist_items ' +
        '(id,organization_id,declaration_id,item_key,item_label,completed,sort_order,source,is_active,created_by,created_at,updated_at) ' +
        'VALUES (?,?,?,?,?,0,?,\'manual\',1,?,?,?)',
      ).bind(id, profile.organization_id, declaration.id, after.item_key, label, sortOrder, profile.id, now, now),
      insertAudit(db, profile, 'create', 'declaration_checklist_item', id, null, after, requestId),
    ]);
    return json({ ok: true, item: after }, 201);
  } catch { return fail('CHECKLIST_ITEM_CREATE_FAILED', 503); }
};

const updateChecklistItem = async (
  request: Request,
  db: DeclarationExitD1Database,
  declaration: DeclarationRow,
  profile: DeclarationExitProfile,
  itemId: string,
  requestId: string,
) => {
  const body = await bodyObject(request);
  if (body instanceof Response) return body;
  const before = await db.prepare(
    'SELECT id,organization_id,declaration_id,item_key,item_label,completed,completed_at,completed_by,note,sort_order,source,is_active,updated_at ' +
    'FROM declaration_checklist_items WHERE id=? AND organization_id=? AND declaration_id=? LIMIT 1',
  ).bind(itemId, profile.organization_id, declaration.id).first<ChecklistRow>();
  if (!before) return fail('CHECKLIST_ITEM_NOT_FOUND', 404);
  const allowed = new Set(['completed', 'note', 'is_active']);
  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !allowed.has(key))) return fail('INVALID_CHECKLIST_PATCH', 422);
  const patch: JsonObject = {};
  if ('completed' in body) {
    if (typeof body.completed !== 'boolean') return fail('INVALID_COMPLETED_VALUE', 422);
    patch.completed = body.completed ? 1 : 0;
    patch.completed_at = body.completed ? new Date().toISOString() : null;
    patch.completed_by = body.completed ? profile.id : null;
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') return fail('INVALID_IS_ACTIVE_VALUE', 422);
    patch.is_active = body.is_active ? 1 : 0;
  }
  if ('note' in body) {
    if (body.note !== null && typeof body.note !== 'string') return fail('INVALID_CHECKLIST_NOTE', 422);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > 4000) return fail('INVALID_CHECKLIST_NOTE', 422);
    patch.note = note || null;
    patch.note_updated_at = note ? new Date().toISOString() : null;
    patch.note_updated_by = note ? profile.id : null;
  }
  const now = new Date().toISOString();
  const columns = Object.keys(patch);
  const values = columns.map(key => patch[key]);
  const sets = columns.map(key => key + '=?').concat(['updated_at=?']);
  const after = { ...before, ...patch, updated_at: now };
  try {
    const results = await db.batch([
      db.prepare(
        'UPDATE declaration_checklist_items SET ' + sets.join(', ') +
        ' WHERE id=? AND organization_id=? AND declaration_id=? AND updated_at=?',
      ).bind(...values, now, itemId, profile.organization_id, declaration.id, before.updated_at),
      db.prepare(
        'INSERT INTO customs_os_audit_events ' +
        '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
        'SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0',
      ).bind(
        crypto.randomUUID(), profile.organization_id, profile.id, 'update',
        'declaration_checklist_item', itemId, JSON.stringify(before), JSON.stringify(after), requestId.slice(0, 180),
      ),
    ]);
    const updated = (results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes;
    if (!updated) return fail('CHECKLIST_ITEM_UPDATE_CONFLICT', 409);
    return json({ ok: true, item: { ...after, completed: boolInt(after.completed) === 1, is_active: boolInt(after.is_active) === 1 } });
  } catch { return fail('CHECKLIST_ITEM_UPDATE_FAILED', 503); }
};

const advanceToExitStage = async (
  db: DeclarationExitD1Database,
  declaration: DeclarationRow,
  profile: DeclarationExitProfile,
  requestId: string,
) => {
  const stage = Number(declaration.workflow_stage);
  if (![4, 5, 6].includes(stage)) return fail('DECLARATION_STAGE_NOT_ADVANCEABLE', 409, { workflowStage: declaration.workflow_stage });
  await ensureChecklist(db, declaration);
  const learning = await recordLearning(db, profile, declaration);
  const now = new Date().toISOString();
  const after = { workflow_stage: 6, remaining_items: [] as string[], partial_allowed: true };
  const checklist = await readChecklist(db, declaration.id, profile.organization_id);
  after.remaining_items = remainingItems(checklist.results);
  const results = await db.batch([
    db.prepare(
      'UPDATE customs_declarations SET workflow_stage=6,updated_at=? WHERE id=? AND organization_id=? AND workflow_stage IN (4,5,6)',
    ).bind(now, declaration.id, profile.organization_id),
    db.prepare(
      'INSERT INTO customs_os_audit_events ' +
      '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
      'SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0',
    ).bind(
      crypto.randomUUID(), profile.organization_id, profile.id, 'update',
      'customs_declaration', declaration.id, JSON.stringify({ workflow_stage: stage }),
      JSON.stringify({ ...after, remaining_items: after.remaining_items }), requestId.slice(0, 180),
    ),
  ]);
  const updated = (results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes;
  if (!updated) return fail('DECLARATION_STAGE_UPDATE_CONFLICT', 409);
  return json({
    ok: true, workflow_stage: 6, partial_allowed: after.remaining_items.length > 0,
    remaining_items: after.remaining_items, learning,
  });
};

const completeExit = async (
  request: Request,
  db: DeclarationExitD1Database,
  declaration: DeclarationRow,
  profile: DeclarationExitProfile,
  requestId: string,
) => {
  const body = await bodyObject(request);
  if (body instanceof Response) return body;
  const [checklist, exitChecklist, workflow] = await Promise.all([
    readChecklist(db, declaration.id, profile.organization_id),
    readExitChecklist(db, declaration.id, profile.organization_id),
    getWorkflow(db, declaration.id, profile.organization_id),
  ]);
  const done = new Set(exitChecklist.results.filter(row => boolInt(row.completed) === 1).map(row => row.item_key));
  const missing = EXIT_ITEMS.filter(item => !done.has(item.key)).map(item => item.label);
  if (missing.length) return json({ ok: true, ready: false, issues: ['سه مورد اجباری درب خروج تکمیل نشده‌اند: ' + missing.join('، ')] });
  // The legacy server-side completion contract is currently defined only for
  // definitive imports. Other regimes have separate readiness rules and must
  // remain blocked until those rules are ported rather than being released by
  // a weaker generic checklist.
  if (declaration.customs_regime !== 'import_definitive') {
    return fail('CUSTOMS_REGIME_EXIT_NOT_MIGRATED', 409);
  }

  const loadingPermit = workflow ? parseObject(workflow.loading_permit_state) : {};
  const workflowSata = boundedText(loadingPermit.sata_code, 100) || '';
  const existingSata = workflowSata || boundedText(declaration.sata_code, 100) || '';
  const requestedSata = boundedText(body.sata_code, 100) || '';
  const sataCode = requestedSata || existingSata;
  const financeStatus = String(declaration.finance_status || '');
  const sataNotRequired = loadingPermit.central_bank_status === 'not_required' ||
    (loadingPermit.clearance_90_percent_requested === true && String(loadingPermit.comment || '').trim() !== '');
  const issues: string[] = [];
  if (!['not_ready', 'ready', 'closed'].includes(financeStatus)) {
    issues.push('وضعیت مالی محموله برای تحویل نهایی معتبر نیست.');
  }
  if (['ready', 'closed'].includes(financeStatus) && sataCode && sataCode !== existingSata) {
    issues.push('کد ساتا پس از تحویل محموله به مالی قابل تغییر نیست.');
  }
  if (!sataCode && !sataNotRequired) issues.push('کد ساتا ثبت نشده و استثنای مجاز عدم نیاز نیز وجود ندارد.');
  issues.push(...stageIssue(declaration, workflow));
  if (remainingItems(checklist.results).length) {
    issues.push('چک‌لیست عمومی عملیات گمرکی هنوز موارد باز دارد.');
  }
  if (issues.length) return json({ ok: true, ready: false, issues });
  if (!declaration.shipment_id) return fail('DECLARATION_SHIPMENT_REQUIRED', 409);
  if (!declaration.linked_shipment_id) return fail('DECLARATION_SHIPMENT_NOT_FOUND', 409);
  const columns = await db.prepare('PRAGMA table_info(shipments)').all<{ name: string }>();
  if (!columns.results.some(column => column.name === 'finance_status')) {
    return fail('SHIPMENT_FINANCE_STATUS_COLUMN_MISSING', 503);
  }
  const now = new Date().toISOString();
  const before = {
    workflow_stage: declaration.workflow_stage,
    sata_code: declaration.sata_code,
  };
  const statements: DeclarationExitD1Statement[] = [];
  const nextWorkflow = workflow
    ? { ...parseObject(workflow.loading_permit_state), ...(sataCode ? { sata_code: sataCode } : {}) }
    : null;
  // Start with the shipment release update. Every following write is conditional
  // on this statement changing exactly one tenant-scoped shipment row.
  statements.push(db.prepare(
    'UPDATE shipments SET finance_status=CASE WHEN finance_status=\'not_ready\' THEN \'ready\' ELSE finance_status END,' +
    'updated_at=CASE WHEN finance_status=\'not_ready\' THEN ? ELSE updated_at END ' +
    'WHERE id=? AND organization_id=? ' +
    'AND EXISTS (SELECT 1 FROM customs_declarations d WHERE d.id=? AND d.organization_id=? ' +
    'AND d.shipment_id=shipments.id AND d.workflow_stage IN (4,5,6)) ' +
    'AND finance_status IN (\'not_ready\',\'ready\',\'closed\') ' +
    'AND (SELECT COUNT(*) FROM declaration_exit_checklist_items e WHERE e.declaration_id=? ' +
    'AND e.organization_id=? AND e.completed=1) = 3 ' +
    'AND (? <> \'import_definitive\' OR NOT EXISTS (' +
    'SELECT 1 FROM declaration_checklist_items i WHERE i.declaration_id=? AND i.organization_id=? ' +
    'AND i.is_active=1 AND i.completed=0)) ' +
    'AND (? = \'\' OR EXISTS (SELECT 1 FROM customs_declaration_workflow w WHERE w.id=? ' +
    'AND w.organization_id=? AND w.declaration_id=? AND w.updated_at=?))',
  ).bind(
    now, declaration.shipment_id, profile.organization_id, declaration.id, profile.organization_id,
    declaration.id, profile.organization_id, declaration.customs_regime,
    declaration.id, profile.organization_id, sataCode,
    workflow?.id || '', workflow?.id || '', profile.organization_id, declaration.id, workflow?.updated_at || '',
  ));
  statements.push(db.prepare(
    'UPDATE customs_declarations SET workflow_stage=6,updated_at=? ' +
    'WHERE id=? AND organization_id=? AND changes()>0',
  ).bind(now, declaration.id, profile.organization_id));
  if (sataCode) {
    statements.push(db.prepare(
      'INSERT INTO shipment_customs_data (shipment_id,organization_id,sata_code) ' +
      'SELECT ?,?,? WHERE changes()>0 ' +
      'ON CONFLICT(shipment_id) DO UPDATE SET sata_code=excluded.sata_code',
    ).bind(declaration.shipment_id, profile.organization_id, sataCode));
  }
  if (workflow) {
    statements.push(db.prepare(
      'UPDATE customs_declaration_workflow SET current_stage=\'completed\',loading_permit_state=?,updated_by=?,updated_at=?,last_event_type=\'saved\' ' +
      'WHERE id=? AND organization_id=? AND declaration_id=? AND updated_at=? AND changes()>0',
    ).bind(JSON.stringify(nextWorkflow), profile.id, now, workflow.id, profile.organization_id, declaration.id, workflow.updated_at));
  }
  statements.push(db.prepare(
    'INSERT INTO customs_os_audit_events ' +
    '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
    'SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0',
  ).bind(
    crypto.randomUUID(), profile.organization_id, profile.id, 'update', 'customs_declaration_exit',
    declaration.id, JSON.stringify(before),
    JSON.stringify({ workflow_stage: 6, finance_status: 'ready', sata_code: sataCode || null, completed_at: now }),
    requestId.slice(0, 180),
  ));
  try {
    const results = await db.batch(statements);
    const shipmentChanges = (results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes;
    if (!shipmentChanges) return fail('DECLARATION_EXIT_COMPLETION_FAILED', 503);
    return json({ ok: true, ready: true, workflow_stage: 6, finance_status: financeStatus === 'not_ready' ? 'ready' : financeStatus, shipment_id: declaration.shipment_id });
  } catch { return fail('DECLARATION_EXIT_COMPLETION_FAILED', 503); }
};

export const handleDeclarationExitApi = async (
  request: Request,
  db: DeclarationExitD1Database,
  url: URL,
  profile: DeclarationExitProfile,
): Promise<Response> => {
  if (!profile.is_active || !profile.id || !profile.organization_id || !READ_ROLES.has(profile.role)) {
    return fail('FORBIDDEN', 403);
  }
  const route = parseRoute(url.pathname);
  if (route instanceof Response) return route;
  const declaration = await getDeclaration(db, route.declarationId, profile.organization_id).catch(() => null);
  if (!declaration) return fail('DECLARATION_NOT_FOUND', 404);
  if (request.method === 'GET' && route.action === 'read') return handleRead(db, declaration, profile);
  if (!sameOrigin(request, url)) return fail('ORIGIN_FORBIDDEN', 403);
  if (!WRITE_ROLES.has(profile.role)) return fail('FORBIDDEN', 403);
  const requestId = request.headers.get('cf-ray') || request.headers.get('x-request-id') || crypto.randomUUID();
  try {
    if (route.action === 'checklist' && request.method === 'POST') {
      return updateExitItem(request, db, declaration, profile, requestId);
    }
    if (route.action === 'items' && request.method === 'POST') {
      await ensureChecklist(db, declaration);
      return createChecklistItem(request, db, declaration, profile, requestId);
    }
    if (route.action === 'item' && request.method === 'PATCH' && route.itemId) {
      return updateChecklistItem(request, db, declaration, profile, route.itemId, requestId);
    }
    if (route.action === 'advance' && request.method === 'POST') {
      return advanceToExitStage(db, declaration, profile, requestId);
    }
    if (route.action === 'complete' && request.method === 'POST') {
      return completeExit(request, db, declaration, profile, requestId);
    }
    return fail('METHOD_NOT_ALLOWED', 405);
  } catch { return fail('DECLARATION_EXIT_API_FAILED', 503); }
};

export const declarationExitChecklistItems = EXIT_ITEMS;
export const declarationStandardChecklistItems = STANDARD_ITEMS;
