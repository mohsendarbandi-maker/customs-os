export interface CaseSelectorD1Statement {
  bind(...values: unknown[]): CaseSelectorD1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface CaseSelectorD1Database {
  prepare(sql: string): CaseSelectorD1Statement;
}
export interface CaseSelectorProfile {
  id: string;
  organization_id: string;
  role: string;
  is_active: boolean;
}
export interface CaseSelectorClient {
  id: string;
  name: string;
  national_id: string | null;
}
export interface CaseSelectorVessel {
  id: string;
  name: string;
  imo_number: string | null;
  flag_code: string | null;
  shipping_line_id: string | null;
}
export interface CaseSelectorShipment {
  id: string;
  case_id: string | null;
  client_id: string | null;
  vessel_id: string | null;
  created_at: string;
  updated_at: string;
  case_created_at: string | null;
  client_name: string | null;
  vessel_name: string | null;
  cargo_count: number | string | null;
  cargo_count_unit: string | null;
  net_weight_kg: number | string | null;
  gross_weight_kg: number | string | null;
  cargo_description: string | null;
  warehouse_receipt_date: string | null;
  initial_warehousing_invoice_confirmed_at: string | null;
  current_status: string | null;
  transport_documents_status: string | null;
  release_invoice_payment_status: string | null;
  finance_status: string | null;
  bill_of_lading_no: string | null;
}
export interface CaseSelectorDeclaration {
  id: string;
  shipment_id: string;
  case_id: string | null;
  kottaj_number: string | null;
  declaration_date: string | null;
  customs_path: string | null;
  workflow_stage: number | null;
  created_at: string | null;
}

const roles = new Set(['owner', 'admin', 'broker', 'accountant', 'warehouse']);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  },
});
const fail = (code: string, status: number) => json({ ok: false, error: code }, status);

export const handleCaseSelectorApi = async (
  request: Request,
  db: CaseSelectorD1Database,
  profile: CaseSelectorProfile,
): Promise<Response> => {
  if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405);
  if (!profile.is_active || !roles.has(profile.role)) return fail('FORBIDDEN', 403);
  if (!profile.id || !profile.organization_id) return fail('INVALID_SESSION_PROFILE', 401);

  try {
    const organizationId = profile.organization_id;
    const [clients, vessels, shipments, declarations] = await Promise.all([
      db.prepare(
        'SELECT id,name,national_id FROM clients WHERE organization_id=? ORDER BY name COLLATE NOCASE,id LIMIT 1000',
      ).bind(organizationId).all<CaseSelectorClient>(),
      db.prepare(
        'SELECT id,name,imo_number,flag_code,shipping_line_id FROM vessels WHERE organization_id=? ORDER BY name COLLATE NOCASE,id LIMIT 1000',
      ).bind(organizationId).all<CaseSelectorVessel>(),
      db.prepare(
        'SELECT s.id,s.case_id,COALESCE(s.client_id,c.client_id) AS client_id,s.vessel_id,' +
        's.created_at,s.updated_at,c.created_at AS case_created_at,cl.name AS client_name,v.name AS vessel_name,' +
        's.cargo_count,s.cargo_count_unit,s.net_weight_kg,s.gross_weight_kg,c.cargo_description,' +
        'c.warehouse_receipt_date,c.initial_warehousing_invoice_confirmed_at,s.current_status,' +
        's.transport_documents_status,s.release_invoice_payment_status,s.finance_status,s.bill_of_lading_no ' +
        'FROM shipments s LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id ' +
        'LEFT JOIN clients cl ON cl.id=COALESCE(s.client_id,c.client_id) AND cl.organization_id=s.organization_id ' +
        'LEFT JOIN vessels v ON v.id=s.vessel_id AND v.organization_id=s.organization_id ' +
        'WHERE s.organization_id=? ORDER BY COALESCE(c.created_at,s.created_at) DESC,s.created_at DESC,s.id DESC LIMIT 1000',
      ).bind(organizationId).all<CaseSelectorShipment>(),
      db.prepare(
        'SELECT id,shipment_id,case_id,kottaj_number,declaration_date,customs_path,workflow_stage,created_at ' +
        'FROM customs_declarations WHERE organization_id=? ORDER BY created_at DESC,id DESC LIMIT 2000',
      ).bind(organizationId).all<CaseSelectorDeclaration>(),
    ]);

    return json({
      ok: true,
      clients: clients.results,
      vessels: vessels.results,
      shipments: shipments.results,
      declarations: declarations.results,
      dataScope: 'authenticated_organization_only',
      checklistStatus: 'not_migrated',
      checklistCompletionVerified: false,
    });
  } catch {
    return fail('CASE_SELECTOR_DATA_UNAVAILABLE', 503);
  }
};
