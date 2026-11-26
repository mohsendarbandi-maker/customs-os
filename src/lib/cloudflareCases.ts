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
export interface CasesListResponse {
  ok: true; items: CaseRecord[]; total: number; limit: number; offset: number;
  searchApplied: boolean; statusFilter: string | null; dataScope: 'authenticated_organization_only';
  readOnly: true;
}
export interface CaseDetailResponse {
  ok: true; case: CaseRecord; shipments: Array<Record<string, unknown>>;
  declarations: Array<Record<string, unknown>>; documents: Array<Record<string, unknown>>;
  permits: CasePermit[];
  readOnly: true; workflowReadiness: 'not_included'; stageTransitions: 'not_supported';
}
export interface CaseStatusHistoryEvent {
  id: string; case_id: string; changed_by: string; previous_status: string | null;
  new_status: string; notes: string | null; created_at: string;
}
export interface CaseAuditEvent {
  id: string; user_id: string; action: 'INSERT' | 'UPDATE' | 'DELETE';
  table_name: string; record_id: string; old_data: string | null;
  new_data: string | null; created_at: string;
}
export interface CaseHistoryResponse {
  ok: true;
  case: Pick<CaseRecord, 'id' | 'case_number' | 'status' | 'client_id' | 'created_at'>;
  history: CaseStatusHistoryEvent[];
  audit: CaseAuditEvent[];
  historySource: 'customs_os_audit_events';
  legacyHistoryBackfill: 'not_imported';
  dataScope: 'authenticated_organization_only';
}
export type CloudflareCasePatch = Partial<Pick<CaseRecord,
  'case_number' | 'registration_order_no' | 'proforma_no' | 'cargo_description' |
  'cargo_count' | 'cargo_count_unit' | 'net_weight_kg' | 'gross_weight_kg' |
  'warehouse_receipt_no' | 'warehouse_receipt_date' | 'release_status' | 'valuation_status' |
  'unloading_date' | 'vessel_type' | 'origin_country_code' | 'transaction_country_code' |
  'delivery_term' | 'invoice_amount' | 'invoice_currency' | 'insurance_amount_irr' |
  'tariff_code' | 'import_duty_rate'
>>;
export interface CloudflareCaseCreateInput {
  client_id: string;
  registration_order_no?: string | null;
}
export interface CloudflareCaseValuationInput {
  customs_fx_rate_irr: number | string;
  import_duty_rate: number | string;
  vat_rate?: number | string;
}

export interface CasePermit {
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
export type CasePermitInput = Partial<Pick<CasePermit,
  'permit_type' | 'permit_number' | 'issuing_authority' | 'status' | 'issued_at' | 'expires_at'
>> & Pick<CasePermit, 'permit_type' | 'issuing_authority'>;
const write = async <T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>): Promise<T> => {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined
      ? { Accept: 'application/json' }
      : { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let result: Record<string, unknown>;
  try { result = await response.json() as Record<string, unknown>; }
  catch { throw new CloudflareCasesApiError('INVALID_API_RESPONSE'); }
  if (!response.ok) {
    throw new CloudflareCasesApiError(typeof result.error === 'string' ? result.error : 'REQUEST_FAILED');
  }
  return result as T;
};

export class CloudflareCasesApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code === 'UNAUTHORIZED' ? 'نشست ورود معتبر نیست؛ دوباره وارد شوید.'
      : code === 'FORBIDDEN' ? 'دسترسی لازم برای مشاهده پرونده‌ها وجود ندارد.'
      : code === 'CASE_NOT_FOUND' ? 'پرونده پیدا نشد یا به آن دسترسی ندارید.'
      : code === 'INVALID_CASE_PATCH' || code === 'INVALID_RELEASE_STATUS' || code === 'INVALID_VALUATION_STATUS' || code === 'INVALID_CASE_NUMBER_VALUE' || code === 'INVALID_CASE_NUMBER' || code === 'GROSS_WEIGHT_BELOW_NET_WEIGHT' ? 'اطلاعات ویرایش پرونده معتبر نیست.'
      : code === 'CASE_NUMBER_EXISTS' ? 'شماره پرونده قبلاً در این سازمان ثبت شده است.'
      : code === 'CASE_UPDATE_CONFLICT' || code === 'PERMIT_UPDATE_CONFLICT' || code === 'PERMIT_DELETE_CONFLICT' ? 'اطلاعات هم‌زمان توسط کاربر دیگری تغییر کرده است؛ دوباره بارگذاری کنید.'
      : code === 'PERMIT_NOT_FOUND' ? 'مجوز پیدا نشد یا به این پرونده تعلق ندارد.'
      : code === 'PERMIT_EXPIRY_BEFORE_ISSUE' || code === 'INVALID_PERMIT_INPUT' || code === 'INVALID_PERMIT_STATUS' || code === 'INVALID_PERMIT_DATE' ? 'اطلاعات مجوز یا تاریخ‌های آن معتبر نیست.'
      : code === 'PERMIT_CREATE_FAILED' || code === 'PERMIT_CREATE_NOT_CONFIRMED' ? 'ثبت مجوز تأیید نشد؛ اطلاعات پرونده و دسترسی را بررسی کنید.'
      : code === 'PERMIT_UPDATE_FAILED' || code === 'PERMIT_UPDATE_NOT_CONFIRMED' ? 'ویرایش مجوز انجام نشد؛ دوباره اطلاعات را بارگذاری کنید.'
      : code === 'PERMIT_DELETE_FAILED' ? 'حذف مجوز انجام نشد؛ دوباره تلاش کنید.'
      : code === 'CASE_PERMITS_API_NOT_READY' ? 'اطلاعات مجوزهای این پرونده در D1 در دسترس نیست.'
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
const post = async <T>(path: string, payload: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  let body: Record<string, unknown>;
  try { body = await response.json() as Record<string, unknown>; }
  catch { throw new CloudflareCasesApiError('INVALID_API_RESPONSE'); }
  if (!response.ok) throw new CloudflareCasesApiError(typeof body.error === 'string' ? body.error : 'REQUEST_FAILED');
  return body as T;
};
export const cloudflareCasesApi = {
  create: (input: CloudflareCaseCreateInput) =>
    post<{ ok: true; case: CaseRecord; created: boolean }>('/api/cases', input),
  list: (options: { search?: string; status?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    query.set('limit', String(options.limit ?? 100));
    query.set('offset', String(options.offset ?? 0));
    if (options.search?.trim()) query.set('search', options.search.trim());
    if (options.status?.trim()) query.set('status', options.status.trim());
    return get<CasesListResponse>('/api/cases?' + query.toString());
  },
  get: (id: string) => get<CaseDetailResponse>('/api/cases/' + encodeURIComponent(id)),
  history: (id: string) => get<CaseHistoryResponse>('/api/cases/' + encodeURIComponent(id) + '/history'),
  permits: (caseId: string) => get<{ ok: true; permits: CasePermit[] }>(
    '/api/cases/' + encodeURIComponent(caseId) + '/permits',
  ),
  createPermit: (caseId: string, input: CasePermitInput) => write<{ ok: true; permit: CasePermit }>(
    '/api/cases/' + encodeURIComponent(caseId) + '/permits', 'POST', input as Record<string, unknown>,
  ),
  updatePermit: (caseId: string, permitId: string, patch: Partial<CasePermitInput>) => write<{ ok: true; permit: CasePermit }>(
    '/api/cases/' + encodeURIComponent(caseId) + '/permits/' + encodeURIComponent(permitId), 'PATCH', patch as Record<string, unknown>,
  ),
  deletePermit: (caseId: string, permitId: string) => write<{ ok: true; deleted: boolean; permitId: string }>(
    '/api/cases/' + encodeURIComponent(caseId) + '/permits/' + encodeURIComponent(permitId), 'DELETE',
  ),
  update: async (id: string, patch: CloudflareCasePatch) => {
    const response = await fetch('/api/cases/' + encodeURIComponent(id), {
      method: 'PATCH',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(patch),
    });
    let body: Record<string, unknown>;
    try { body = await response.json() as Record<string, unknown>; }
    catch { throw new CloudflareCasesApiError('INVALID_API_RESPONSE'); }
    if (!response.ok) throw new CloudflareCasesApiError(
      typeof body.error === 'string' ? body.error : 'REQUEST_FAILED',
    );
    return body as { ok: true; case: CaseRecord; unchanged?: boolean; stageAdvanced?: boolean };
  },
  calculateValuation: (id: string, input: CloudflareCaseValuationInput) =>
    post<{
      ok: true; case: CaseRecord;
      valuation: {
        customs_value_irr: string; import_duty_irr: string; vat_irr: string;
        total_payable_irr: string; customs_fx_rate_irr: string; import_duty_rate: string; vat_rate: string;
      };
    }>('/api/cases/' + encodeURIComponent(id) + '/valuation', input),
};
