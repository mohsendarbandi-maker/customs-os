export interface CaseRecord {
  id: string; case_number: string | null; status: string | null; client_id: string | null;
  client_name: string | null; customs_office_id: string | null; registration_order_no: string | null;
  proforma_no: string | null; cargo_description: string | null; cargo_count: number | null;
  cargo_count_unit: string | null; net_weight_kg: number | null; gross_weight_kg: number | null;
  display_name: string | null; created_at: string | null; updated_at: string | null;
  shipment_count: number; latest_shipment_id: string | null; shipment_display_name: string | null;
  bill_of_lading_no: string | null; vessel_name: string | null; kottaj_number: string | null;
}
export interface CasesListResponse {
  ok: true; items: CaseRecord[]; total: number; limit: number; offset: number;
  searchApplied: boolean; statusFilter: string | null; dataScope: 'authenticated_organization_only';
  readOnly: true;
}
export interface CaseDetailResponse {
  ok: true; case: CaseRecord; shipments: Array<Record<string, unknown>>;
  declarations: Array<Record<string, unknown>>; documents: Array<Record<string, unknown>>;
  readOnly: true; workflowReadiness: 'not_included'; stageTransitions: 'not_supported';
}
export class CloudflareCasesApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code === 'UNAUTHORIZED' ? 'نشست ورود معتبر نیست؛ دوباره وارد شوید.'
      : code === 'FORBIDDEN' ? 'دسترسی لازم برای مشاهده پرونده‌ها وجود ندارد.'
      : code === 'CASE_NOT_FOUND' ? 'پرونده پیدا نشد یا به آن دسترسی ندارید.'
      : 'دریافت اطلاعات پرونده ناموفق بود: ' + code);
    this.name = 'CloudflareCasesApiError'; this.code = code;
  }
}
const get = async <T>(path: string): Promise<T> => {
  const response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
  let body: Record<string, unknown>;
  try { body = await response.json() as Record<string, unknown>; }
  catch { throw new CloudflareCasesApiError('INVALID_API_RESPONSE'); }
  if (!response.ok) throw new CloudflareCasesApiError(typeof body.error === 'string' ? body.error : 'REQUEST_FAILED');
  return body as T;
};
export const cloudflareCasesApi = {
  list: (options: { search?: string; status?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    query.set('limit', String(options.limit ?? 100));
    query.set('offset', String(options.offset ?? 0));
    if (options.search?.trim()) query.set('search', options.search.trim());
    if (options.status?.trim()) query.set('status', options.status.trim());
    return get<CasesListResponse>('/api/cases?' + query.toString());
  },
  get: (id: string) => get<CaseDetailResponse>('/api/cases/' + encodeURIComponent(id)),
};
