export interface PreDeclarationD1Statement {
  bind(...values: unknown[]): PreDeclarationD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface PreDeclarationD1Database {
  prepare(sql: string): PreDeclarationD1Statement;
  batch(statements: PreDeclarationD1Statement[]): Promise<unknown[]>;
}
export interface PreDeclarationProfile {
  id: string;
  organization_id: string;
  role: string;
  is_active: boolean;
}
interface ShipmentRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  case_id: string | null;
  client_id: string | null;
  registration_order_id: string | null;
  customs_office_id: string | null;
}
const PREFIX = '/api/pre-declaration/';
const READ_ROLES = new Set(['owner','admin','broker','accountant','warehouse']);
const WRITE_ROLES = new Set(['owner','admin','broker']);
const REGIMES = new Set([
  'import_definitive','export_definitive','temporary_export','import_temporary',
  'temporary_processing','re_export','external_transit','internal_transit','re_import',
  'cabotage','customs_warehouse','free_zone','other',
]);
const FIELDS = [
  'customs_office_id','customs_regime','vessel_type','registration_order_no',
  'registration_order_date_shamsi','package_count','warehouse_receipt_no',
  'warehouse_receipt_date_shamsi','cargo_description','origin_country',
  'transaction_country','delivery_term','invoice_amount','invoice_currency',
  'sata_code','duty_rate','tariff_code','net_weight_kg','gross_weight_kg',
  'bill_of_lading','insurance_irr','required_documents','source_method','source_text',
] as const;
type Field = typeof FIELDS[number];
const STRING_FIELDS = new Set<Field>([
  'customs_office_id','customs_regime','vessel_type','registration_order_no',
  'registration_order_date_shamsi','warehouse_receipt_no','warehouse_receipt_date_shamsi',
  'cargo_description','origin_country','transaction_country','delivery_term',
  'invoice_currency','sata_code','tariff_code','bill_of_lading','required_documents',
  'source_method','source_text',
]);
const NUMERIC_FIELDS = new Set<Field>([
  'package_count','invoice_amount','duty_rate','net_weight_kg','gross_weight_kg','insurance_irr',
]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store, private',
    'x-content-type-options':'nosniff',
    'referrer-policy':'same-origin',
  },
});
const fail = (error: string, status: number, details: Record<string, unknown> = {}) =>
  json({ ok: false, error, ...details }, status);
const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
};
const parseId = (pathname: string): string | Response => {
  if (!pathname.startsWith(PREFIX)) return fail('NOT_FOUND',404);
  const raw = pathname.slice(PREFIX.length);
  if (!raw || raw.includes('/')) return fail('INVALID_SHIPMENT_ID',400);
  try {
    const id = decodeURIComponent(raw);
    if (!id || id.length > 128 || id.includes('/')) return fail('INVALID_SHIPMENT_ID',400);
    return id;
  } catch { return fail('INVALID_SHIPMENT_ID',400); }
};
const boundedBody = async (request: Request): Promise<Record<string, unknown> | Response> => {
  if (Number(request.headers.get('content-length') || 0) > 32 * 1024) return fail('REQUEST_TOO_LARGE',413);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 32 * 1024) return fail('REQUEST_TOO_LARGE',413);
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : fail('INVALID_JSON',400);
  } catch { return fail('INVALID_JSON',400); }
};
const readShipment = (db: PreDeclarationD1Database, id: string, organizationId: string) =>
  db.prepare(
    'SELECT s.id,s.organization_id,s.case_id,s.client_id,s.registration_order_id,s.shipping_line,' +
    's.bill_of_lading_no,s.cargo_count,s.cargo_count_unit,s.net_weight_kg,s.gross_weight_kg,' +
    's.current_status,s.display_name,s.customs_office_id,c.registration_order_no AS case_registration_order_no,' +
    'cl.name AS client_name FROM shipments s ' +
    'LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id ' +
    'LEFT JOIN clients cl ON cl.id=s.client_id AND cl.organization_id=s.organization_id ' +
    'WHERE s.id=? AND s.organization_id=? LIMIT 1',
  ).bind(id,organizationId).first<ShipmentRow>();

const readData = (db: PreDeclarationD1Database, id: string, organizationId: string) =>
  db.prepare(
    'SELECT shipment_id,organization_id,customs_office_id,customs_regime,vessel_type,' +
    'registration_order_no,registration_order_date_shamsi,package_count,warehouse_receipt_no,' +
    'warehouse_receipt_date_shamsi,cargo_description,origin_country,transaction_country,delivery_term,' +
    'invoice_amount,invoice_currency,bank_branch_code,bank_name,bank_branch,lc_number,duty_rate,' +
    'tariff_code,net_weight_kg,gross_weight_kg,bill_of_lading,insurance_irr,required_documents,' +
    'source_method,source_text,created_by,created_at,updated_at,sata_code ' +
    'FROM shipment_customs_data WHERE shipment_id=? AND organization_id=? LIMIT 1',
  ).bind(id,organizationId).first<Record<string, unknown>>();

const readRegistrationOrder = async (
  db: PreDeclarationD1Database,
  shipment: ShipmentRow,
  organizationId: string,
) => {
  const number = typeof shipment.case_registration_order_no === 'string'
    ? shipment.case_registration_order_no.trim() : '';
  if (shipment.registration_order_id) {
    return db.prepare(
      'SELECT id,organization_id,case_id,client_id,order_number,order_date,status,tariff_code,' +
      'quantity,quantity_unit,value_amount,currency,notes,net_weight_kg,gross_weight_kg,' +
      'bank_name,bank_branch,bank_branch_code,payment_instrument_code,is_closed,closed_at ' +
      'FROM registration_orders WHERE id=? AND organization_id=? LIMIT 1',
    ).bind(shipment.registration_order_id,organizationId).first<Record<string, unknown>>();
  }
  if (!number) return null;
  return db.prepare(
    'SELECT id,organization_id,case_id,client_id,order_number,order_date,status,tariff_code,' +
    'quantity,quantity_unit,value_amount,currency,notes,net_weight_kg,gross_weight_kg,' +
    'bank_name,bank_branch,bank_branch_code,payment_instrument_code,is_closed,closed_at ' +
    'FROM registration_orders WHERE order_number=? AND organization_id=? LIMIT 1',
  ).bind(number,organizationId).first<Record<string, unknown>>();
};

const readHistory = async (
  db: PreDeclarationD1Database,
  organizationId: string,
  variants: string[],
) => {
  const safe = Array.from(new Set(variants.map(value => value.trim()).filter(Boolean))).slice(0,8);
  if (!safe.length) return [];
  const placeholders = safe.map(() => '?').join(',');
  const result = await db.prepare(
    'SELECT shipment_id,registration_order_no,bank_name,bank_branch,bank_branch_code,lc_number,updated_at ' +
    'FROM shipment_customs_data WHERE organization_id=? AND registration_order_no IN (' + placeholders + ') ' +
    'ORDER BY updated_at DESC LIMIT 100',
  ).bind(organizationId,...safe).all<Record<string, unknown>>();
  return result.results;
};

const readDocuments = async (db: PreDeclarationD1Database, shipmentId: string, organizationId: string) => {
  const [canonical, legacy] = await Promise.all([
    db.prepare(
      'SELECT id,shipment_id,document_name,original_file_name,storage_path,mime_type,file_size_bytes,' +
      'storage_backend,file_asset_id,folder_id,created_at FROM shipment_documents ' +
      'WHERE shipment_id=? AND organization_id=? AND COALESCE(is_archived,0)=0 ' +
      'ORDER BY created_at ASC,id ASC LIMIT 200',
    ).bind(shipmentId,organizationId).all<Record<string, unknown>>(),
    db.prepare(
      'SELECT id,shipment_id,original_name,display_name,storage_path,mime_type,size_bytes,' +
      'storage_backend,file_asset_id,folder_id,created_at FROM customs_documents ' +
      'WHERE shipment_id=? AND organization_id=? AND COALESCE(is_archived,0)=0 ' +
      'ORDER BY created_at ASC,id ASC LIMIT 200',
    ).bind(shipmentId,organizationId).all<Record<string, unknown>>(),
  ]);
  return {
    canonical: canonical.results,
    legacy: legacy.results,
  };
};

const validateBody = (body: Record<string, unknown>) => {
  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !FIELDS.includes(key as Field))) return null;
  const next: Record<string, unknown> = {};
  for (const key of keys as Field[]) {
    const value = body[key];
    if (STRING_FIELDS.has(key)) {
      if (value !== null && typeof value !== 'string') return null;
      const text = typeof value === 'string' ? value.trim() : null;
      const limit = key === 'source_text' ? 12000 : key === 'cargo_description' || key === 'required_documents' ? 4000 : 300;
      if (text !== null && text.length > limit) return null;
      if (key === 'customs_regime' && text !== null && !REGIMES.has(text)) return null;
      if (key === 'source_method' && text !== null && !['manual','smart-paste','ocr'].includes(text)) return null;
      next[key] = text;
    } else if (NUMERIC_FIELDS.has(key)) {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return null;
      next[key] = value;
    }
  }
  if (next.customs_office_id !== undefined && next.customs_office_id !== null && !String(next.customs_office_id)) return null;
  if (next.net_weight_kg !== undefined && next.gross_weight_kg !== undefined &&
      next.net_weight_kg !== null && next.gross_weight_kg !== null &&
      Number(next.gross_weight_kg) < Number(next.net_weight_kg)) return null;
  return next;
};

export const handlePreDeclarationApi = async (
  request: Request,
  db: PreDeclarationD1Database,
  url: URL,
  profile: PreDeclarationProfile,
): Promise<Response> => {
  if (!profile.is_active || !READ_ROLES.has(profile.role)) return fail('FORBIDDEN',403);
  if (!profile.id || !profile.organization_id) return fail('INVALID_SESSION_PROFILE',401);
  const shipmentId = parseId(url.pathname);
  if (shipmentId instanceof Response) return shipmentId;

  if (request.method === 'GET') {
    try {
      const shipment = await readShipment(db,shipmentId,profile.organization_id);
      if (!shipment) return fail('SHIPMENT_NOT_FOUND',404);
      const [customsData,offices,registrationOrder,documents] = await Promise.all([
        readData(db,shipmentId,profile.organization_id),
        db.prepare(
          'SELECT id,code,name,city,is_active FROM customs_offices ORDER BY name ASC',
        ).all<Record<string, unknown>>(),
        readRegistrationOrder(db,shipment,profile.organization_id),
        readDocuments(db,shipmentId,profile.organization_id),
      ]);
      const rawNumber = url.searchParams.get('registrationOrderNo') || '';
      let variants: string[] = [];
      try {
        const raw = JSON.parse(url.searchParams.get('variants') || '[]') as unknown;
        if (Array.isArray(raw)) variants = raw.filter((item): item is string => typeof item === 'string').slice(0,8);
      } catch { return fail('INVALID_REGISTRATION_ORDER_VARIANTS',400); }
      const bankHistory = await readHistory(db,profile.organization_id,variants);
      return json({
        ok:true,
        shipment,
        customsData,
        customsOffices:offices.results,
        registrationOrder,
        registrationOrderNo:rawNumber || registrationOrder?.order_number || shipment.case_registration_order_no || null,
        bankHistory,
        documents,
      });
    } catch { return fail('PRE_DECLARATION_READ_NOT_READY',503); }
  }

  if (request.method !== 'PATCH') return fail('METHOD_NOT_ALLOWED',405,{ allowed:['GET','PATCH'] });
  if (!sameOrigin(request,url)) return fail('ORIGIN_FORBIDDEN',403);
  if (!WRITE_ROLES.has(profile.role)) return fail('FORBIDDEN',403);
  const body = await boundedBody(request);
  if (body instanceof Response) return body;
  const next = validateBody(body);
  if (!next) return fail('INVALID_PRE_DECLARATION_DATA',422);
  if (!next.customs_office_id || !next.customs_regime) return fail('CUSTOMS_OFFICE_AND_REGIME_REQUIRED',422);

  try {
    const shipment = await readShipment(db,shipmentId,profile.organization_id);
    if (!shipment) return fail('SHIPMENT_NOT_FOUND',404);
    const existing = await readData(db,shipmentId,profile.organization_id);
    const office = await db.prepare(
      'SELECT id,is_active FROM customs_offices WHERE id=? LIMIT 1',
    ).bind(next.customs_office_id).first<{id:string;is_active:number}>();
    if (!office) return fail('CUSTOMS_OFFICE_NOT_FOUND',422);
    if (!office.is_active && office.id !== shipment.customs_office_id) return fail('CUSTOMS_OFFICE_INACTIVE',422);

    const complete: Record<string, unknown> = {
      customs_office_id: shipment.customs_office_id || null,
      customs_regime: null,
      vessel_type:null,registration_order_no:null,registration_order_date_shamsi:null,
      package_count:null,warehouse_receipt_no:null,warehouse_receipt_date_shamsi:null,
      cargo_description:null,origin_country:null,transaction_country:null,delivery_term:null,
      invoice_amount:null,invoice_currency:null,sata_code:null,duty_rate:null,tariff_code:null,
      net_weight_kg:null,gross_weight_kg:null,bill_of_lading:null,insurance_irr:null,
      required_documents:null,source_method:'manual',source_text:null,
      ...(existing || {}),
      ...next,
    };
    const now = new Date().toISOString();
    const oldUpdatedAt = typeof existing?.updated_at === 'string' ? existing.updated_at : null;
    const columns = [
      'shipment_id','organization_id','customs_office_id','customs_regime','vessel_type',
      'registration_order_no','registration_order_date_shamsi','package_count','warehouse_receipt_no',
      'warehouse_receipt_date_shamsi','cargo_description','origin_country','transaction_country',
      'delivery_term','invoice_amount','invoice_currency','sata_code','duty_rate','tariff_code',
      'net_weight_kg','gross_weight_kg','bill_of_lading','insurance_irr','required_documents',
      'source_method','source_text','created_by','created_at','updated_at',
    ];
    const values = [
      shipmentId,profile.organization_id,complete.customs_office_id,complete.customs_regime,
      complete.vessel_type,complete.registration_order_no,complete.registration_order_date_shamsi,
      complete.package_count,complete.warehouse_receipt_no,complete.warehouse_receipt_date_shamsi,
      complete.cargo_description,complete.origin_country,complete.transaction_country,complete.delivery_term,
      complete.invoice_amount,complete.invoice_currency,complete.sata_code,complete.duty_rate,complete.tariff_code,
      complete.net_weight_kg,complete.gross_weight_kg,complete.bill_of_lading,complete.insurance_irr,
      complete.required_documents,complete.source_method,complete.source_text,profile.id,
      existing?.created_at || now,now,
    ];
    const updateColumns = columns.filter(column => !['shipment_id','organization_id','created_at'].includes(column));
    const updateSet = updateColumns.map(column => column + '=excluded.' + column).join(',');
    const upsert = 'INSERT INTO shipment_customs_data (' + columns.join(',') + ') VALUES (' +
      columns.map(() => '?').join(',') + ') ON CONFLICT(shipment_id) DO UPDATE SET ' + updateSet +
      ' WHERE shipment_customs_data.organization_id=excluded.organization_id ' +
      'AND shipment_customs_data.updated_at IS ?';
    const auditBefore: Record<string, unknown> = {};
    const auditAfter: Record<string, unknown> = {};
    for (const field of FIELDS) {
      auditBefore[field] = existing?.[field] ?? null;
      auditAfter[field] = complete[field] ?? null;
    }
    const statements = [
      db.prepare(upsert).bind(...values,oldUpdatedAt),
      db.prepare(
        'INSERT INTO customs_os_audit_events ' +
        '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
        'SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0',
      ).bind(
        crypto.randomUUID(),profile.organization_id,profile.id,'update','shipment_customs_data',shipmentId,
        JSON.stringify(auditBefore),JSON.stringify(auditAfter),
        request.headers.get('cf-ray') || request.headers.get('x-request-id') || null,
      ),
      db.prepare(
        'UPDATE shipments SET customs_office_id=?,updated_at=? ' +
        'WHERE id=? AND organization_id=? AND changes()>0',
      ).bind(complete.customs_office_id,now,shipmentId,profile.organization_id),
      db.prepare(
        'UPDATE cases SET customs_office_id=?,customs_regime=?,updated_at=? ' +
        'WHERE id=(SELECT case_id FROM shipments WHERE id=? AND organization_id=?) ' +
        'AND organization_id=? AND changes()>0',
      ).bind(
        complete.customs_office_id,complete.customs_regime,now,
        shipmentId,profile.organization_id,profile.organization_id,
      ),
    ];
    const results = await db.batch(statements);
    const upsertResult = results[0] as {meta?:{changes?:number}} | undefined;
    if (Number(upsertResult?.meta?.changes || 0) !== 1) {
      return fail('PRE_DECLARATION_CONFLICT',409);
    }
    const saved = await readData(db,shipmentId,profile.organization_id);
    if (!saved) return fail('PRE_DECLARATION_SAVE_NOT_CONFIRMED',500);
    return json({ok:true,customsData:saved});
  } catch { return fail('PRE_DECLARATION_SAVE_FAILED',500); }
};
