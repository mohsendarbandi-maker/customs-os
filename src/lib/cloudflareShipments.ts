export interface CloudflareShipment {
  id: string;
  organization_id: string;
  case_id: string | null;
  registration_order_id: string | null;
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
  registration_order_no: string | null;
  customs_regime: string | null;
  sata_code: string | null;
  cargo_description: string | null;
  transport_documents_status: string | null;
  release_invoice_payment_status: string | null;
  created_at: string;
}
export interface CloudflareShipmentInput {
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
interface ListResponse { ok: true; items: CloudflareShipment[]; total: number; limit: number; offset: number; }
export class CloudflareShipmentsApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    const messages: Record<string, string> = {
      UNAUTHORIZED: 'نشست ورود معتبر نیست؛ دوباره وارد شوید.',
      FORBIDDEN: 'دسترسی لازم برای مدیریت محموله وجود ندارد.',
      CLIENT_NOT_FOUND: 'صاحب کالا پیدا نشد یا به این سازمان تعلق ندارد.',
      CASE_NOT_FOUND: 'پرونده انتخاب‌شده پیدا نشد یا به این سازمان تعلق ندارد.',
      CASE_CLIENT_MISMATCH: 'صاحب کالای محموله با صاحب کالای پرونده یکسان نیست.',
      REGISTRATION_ORDER_NOT_FOUND: 'ثبت سفارش انتخاب‌شده پیدا نشد.',
      DUPLICATE_BILL_OF_LADING: 'این شماره بارنامه قبلاً در سازمان ثبت شده است.',
      GROSS_WEIGHT_BELOW_NET_WEIGHT: 'وزن ناخالص نمی‌تواند از وزن خالص کمتر باشد.',
      SHIPMENTS_API_NOT_READY: 'سرویس محموله‌ها در D1 در دسترس نیست.',
    };
    super(messages[code] || 'عملیات محموله انجام نشد: ' + code);
    this.name = 'CloudflareShipmentsApiError';
    this.code = code;
  }
}
const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  let payload: Record<string, unknown>;
  try { payload = await response.json() as Record<string, unknown>; }
  catch { throw new CloudflareShipmentsApiError('INVALID_API_RESPONSE'); }
  if (!response.ok) {
    throw new CloudflareShipmentsApiError(typeof payload.error === 'string' ? payload.error : 'REQUEST_FAILED');
  }
  return payload as T;
};
export const cloudflareShipmentsApi = {
  list: (options: { search?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    query.set('limit', String(options.limit ?? 200));
    query.set('offset', String(options.offset ?? 0));
    if (options.search?.trim()) query.set('search', options.search.trim());
    return request<ListResponse>('/api/shipments?' + query.toString());
  },
  get: (id: string) => request<{ ok: true; shipment: CloudflareShipment }>(
    '/api/shipments/' + encodeURIComponent(id),
  ),
  create: (input: CloudflareShipmentInput) => request<{ ok: true; shipment: CloudflareShipment }>(
    '/api/shipments', { method: 'POST', body: JSON.stringify(input) },
  ),
  update: (id: string, input: CloudflareShipmentInput) => request<{ ok: true; shipment: CloudflareShipment }>(
    '/api/shipments/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(input) },
  ),
};
