export type RegistrationOrderStatus = 'pending' | 'received' | 'verified' | 'used' | 'cancelled';
export type ExternalAllocationStatus = 'allocated' | 'dispatched' | 'completed' | 'cancelled';

export interface RegistrationOrderInput {
  client_id: string;
  order_number: string;
  order_date: string | null;
  status: RegistrationOrderStatus;
  tariff_code: string | null;
  quantity: number | null;
  quantity_unit: string | null;
  net_weight_kg: number | null;
  gross_weight_kg: number | null;
  value_amount: number | null;
  currency: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_branch_code: string | null;
  payment_instrument_code: string | null;
  notes: string | null;
}

export interface RegistrationOrderRecord extends RegistrationOrderInput {
  id: string;
  organization_id: string;
  case_id: string | null;
  is_closed: boolean;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  client_name: string | null;
  shipment_count: number;
  shipped_net_weight_kg: number;
  shipped_gross_weight_kg: number;
  shipped_value_amount: number;
  shipments_missing_invoice_value: number;
  shipments_with_currency_mismatch: number;
  external_allocation_count: number;
  external_allocated_net_weight_kg: number;
  external_allocated_gross_weight_kg: number;
  external_allocated_value_amount: number;
  external_allocations_missing_value: number;
  external_allocations_currency_mismatch: number;
  total_allocated_net_weight_kg: number;
  total_allocated_gross_weight_kg: number;
  total_allocated_value_amount: number;
  total_allocation_count: number;
}

export interface RegistrationOrderCaseReference {
  id: string;
  registration_order_no: string | null;
  net_weight_kg: number | null;
  gross_weight_kg: number | null;
}

export interface ExternalRegistrationOrderAllocationInput {
  recipient_company: string | null;
  destination_customs: string | null;
  allocation_reference: string | null;
  status: ExternalAllocationStatus;
  net_weight_kg: number;
  gross_weight_kg: number | null;
  value_amount: number;
  currency: string;
  notes: string | null;
}

export interface ExternalRegistrationOrderAllocation extends ExternalRegistrationOrderAllocationInput {
  id: string;
  organization_id: string;
  registration_order_id: string;
  created_at: string;
  updated_at: string;
}

export interface RegistrationOrdersListResponse {
  ok: true;
  items: RegistrationOrderRecord[];
  total: number;
  limit: number;
  offset: number;
  cases: RegistrationOrderCaseReference[];
  reconciliation: RegistrationOrderRecord[];
}

export class CloudflareRegistrationOrdersError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    const messages: Record<string, string> = {
      UNAUTHORIZED: 'نشست ورود معتبر نیست؛ دوباره وارد شوید.',
      FORBIDDEN: 'دسترسی لازم برای مدیریت ثبت سفارش‌ها وجود ندارد.',
      CLIENT_NOT_FOUND: 'صاحب کالا پیدا نشد یا به این سازمان تعلق ندارد.',
      REGISTRATION_ORDER_NOT_FOUND: 'ثبت سفارش پیدا نشد یا به این سازمان تعلق ندارد.',
      REGISTRATION_ORDER_EXISTS: 'این شماره ثبت سفارش قبلاً در همین سازمان ثبت شده است.',
      REGISTRATION_ORDER_CLOSED: 'ثبت سفارش نهایی شده است و تغییر آن مجاز نیست.',
      INVALID_REGISTRATION_ORDER_INPUT: 'اطلاعات ثبت سفارش معتبر نیست؛ وزن، ارزش، ارز و صاحب کالا را بررسی کنید.',
      INVALID_REGISTRATION_ORDER_ALLOCATION_INPUT: 'اطلاعات سهم واگذارشده معتبر نیست.',
      REGISTRATION_ORDER_CAPACITY_REQUIRED: 'ابتدا وزن خالص، ارزش کل و ارز ثبت سفارش مادر را تکمیل کنید.',
      REGISTRATION_ORDER_GROSS_WEIGHT_REQUIRED: 'وزن ناخالص سهم واگذارشده برای این ثبت سفارش الزامی است.',
      REGISTRATION_ORDER_NET_CAPACITY_EXCEEDED: 'جمع وزن خالص از ظرفیت ثبت سفارش بیشتر می‌شود.',
      REGISTRATION_ORDER_GROSS_CAPACITY_EXCEEDED: 'جمع وزن ناخالص از ظرفیت ثبت سفارش بیشتر می‌شود.',
      REGISTRATION_ORDER_VALUE_CAPACITY_EXCEEDED: 'جمع ارزش محموله‌ها و سهم‌های واگذارشده از ارزش ثبت سفارش بیشتر می‌شود.',
      REGISTRATION_ORDER_SHIPMENT_VALUE_INCOMPLETE: 'مبلغ فاکتور و ارز تمام محموله‌های داخلی باید ثبت شود.',
      REGISTRATION_ORDER_SHIPMENT_CURRENCY_MISMATCH: 'ارز فاکتور یک یا چند محموله با ارز ثبت سفارش یکسان نیست.',
      REGISTRATION_ORDER_ALLOCATION_CURRENCY_MISMATCH: 'ارز سهم واگذارشده باید با ارز ثبت سفارش مادر یکسان باشد.',
      ORDER_FINALIZE_NET_WEIGHT_MISMATCH: 'برای نهایی‌سازی، جمع وزن خالص باید دقیقاً با ثبت سفارش برابر باشد.',
      ORDER_FINALIZE_GROSS_WEIGHT_MISMATCH: 'برای نهایی‌سازی، جمع وزن ناخالص باید با ثبت سفارش برابر باشد.',
      ORDER_FINALIZE_VALUE_MISMATCH: 'برای نهایی‌سازی، جمع ارزش باید دقیقاً با ثبت سفارش برابر باشد.',
      ORDER_FINALIZE_MISSING_INVOICE_VALUE: 'مبلغ و ارز فاکتور همه محموله‌ها باید پیش از نهایی‌سازی تکمیل شود.',
      ORDER_FINALIZE_CURRENCY_MISMATCH: 'ارز فاکتور یکی از محموله‌ها یا سهم‌ها با ثبت سفارش مغایرت دارد.',
      ORDER_FINALIZE_REQUIRES_ALLOCATION: 'برای نهایی‌سازی حداقل یک محموله یا سهم واگذارشده لازم است.',
      ORIGIN_FORBIDDEN: 'درخواست از مبدأ غیرمجاز ارسال شده است.',
      REGISTRATION_ORDERS_API_NOT_READY: 'سرویس ثبت سفارش یا Migration پایگاه داده هنوز آماده نیست.',
      REGISTRATION_ORDER_ALLOCATIONS_API_NOT_READY: 'سرویس سهم‌های واگذارشده هنوز آماده نیست.',
    };
    super(messages[code] || 'عملیات ثبت سفارش انجام نشد: ' + code);
    this.name = 'CloudflareRegistrationOrdersError';
    this.code = code;
    this.status = status;
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
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    throw new CloudflareRegistrationOrdersError('INVALID_API_RESPONSE', response.status);
  }
  if (!response.ok) {
    const code = typeof payload.error === 'string' ? payload.error : 'REQUEST_FAILED';
    throw new CloudflareRegistrationOrdersError(code, response.status);
  }
  return payload as T;
};

export const cloudflareRegistrationOrdersApi = {
  list: (options: { search?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    query.set('limit', String(options.limit ?? 100));
    query.set('offset', String(options.offset ?? 0));
    if (options.search?.trim()) query.set('search', options.search.trim());
    return request<RegistrationOrdersListResponse>('/api/registration-orders?' + query.toString());
  },
  create: (input: RegistrationOrderInput) =>
    request<{ ok: true; order: RegistrationOrderRecord }>('/api/registration-orders', {
      method: 'POST', body: JSON.stringify(input),
    }),
  update: (id: string, input: RegistrationOrderInput) =>
    request<{ ok: true; order: RegistrationOrderRecord }>(
      '/api/registration-orders/' + encodeURIComponent(id),
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
  setClosed: (id: string, isClosed: boolean) =>
    request<{ ok: true; order: RegistrationOrderRecord }>(
      '/api/registration-orders/' + encodeURIComponent(id),
      { method: 'PATCH', body: JSON.stringify({ isClosed }) },
    ),
  listExternalAllocations: (orderId: string) =>
    request<{ ok: true; items: ExternalRegistrationOrderAllocation[] }>(
      '/api/registration-orders/' + encodeURIComponent(orderId) + '/external-allocations',
    ),
  createExternalAllocation: (orderId: string, input: ExternalRegistrationOrderAllocationInput) =>
    request<{ ok: true; allocation: ExternalRegistrationOrderAllocation }>(
      '/api/registration-orders/' + encodeURIComponent(orderId) + '/external-allocations',
      { method: 'POST', body: JSON.stringify(input) },
    ),
  updateExternalAllocation: (orderId: string, allocationId: string, input: ExternalRegistrationOrderAllocationInput) =>
    request<{ ok: true; allocation: ExternalRegistrationOrderAllocation }>(
      '/api/registration-orders/' + encodeURIComponent(orderId) + '/external-allocations/' + encodeURIComponent(allocationId),
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
};
