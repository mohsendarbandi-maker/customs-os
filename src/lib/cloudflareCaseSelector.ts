export interface CaseSelectorClient {
  id: string; name: string; national_id: string | null;
}
export interface CaseSelectorVessel {
  id: string; name: string; imo_number: string | null; flag_code: string | null; shipping_line_id: string | null;
}
export interface CaseSelectorRow {
  id: string; case_id: string | null; client_id: string | null; vessel_id: string | null;
  created_at: string; updated_at: string; case_created_at: string | null;
  display_name?: string; client_name: string | null; vessel_name: string | null;
  cargo_count: number | string | null; cargo_count_unit: string | null;
  net_weight_kg: number | string | null; gross_weight_kg: number | string | null;
  cargo_description: string | null; warehouse_receipt_date: string | null;
  initial_warehousing_invoice_confirmed_at: string | null; current_status: string | null;
  transport_documents_status: string | null; release_invoice_payment_status: string | null;
  finance_status: string | null; bill_of_lading_no: string | null;
}
export interface CaseSelectorDeclaration {
  id: string; shipment_id: string; case_id: string | null; kottaj_number: string | null;
  declaration_date: string | null; customs_path: string | null; workflow_stage: number | null;
  created_at: string | null;
}
export interface CaseSelectorResponse {
  ok: true; clients: CaseSelectorClient[]; vessels: CaseSelectorVessel[];
  shipments: CaseSelectorRow[]; declarations: CaseSelectorDeclaration[];
  dataScope: 'authenticated_organization_only';
  checklistStatus: 'not_migrated'; checklistCompletionVerified: false;
}
export class CloudflareCaseSelectorError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code === 'UNAUTHORIZED' ? 'نشست ورود معتبر نیست؛ دوباره وارد شوید.'
      : code === 'FORBIDDEN' ? 'دسترسی لازم برای مشاهده پرونده‌ها وجود ندارد.'
      : 'دریافت اطلاعات انتخاب پرونده از D1 ناموفق بود: ' + code);
    this.name = 'CloudflareCaseSelectorError';
    this.code = code;
  }
}
export const cloudflareCaseSelectorApi = {
  async load(): Promise<CaseSelectorResponse> {
    const response = await fetch('/api/case-selector-data', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    let body: Record<string, unknown>;
    try { body = await response.json() as Record<string, unknown>; }
    catch { throw new CloudflareCaseSelectorError('INVALID_API_RESPONSE'); }
    if (!response.ok) throw new CloudflareCaseSelectorError(
      typeof body.error === 'string' ? body.error : 'REQUEST_FAILED',
    );
    return body as unknown as CaseSelectorResponse;
  },
};
