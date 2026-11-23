export interface ClientRecord {
  id: string;
  name: string;
  national_id: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ClientListResponse {
  ok: true;
  items: ClientRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface ClientInput {
  name: string;
  nationalId: string;
  notes: string;
}

export class CloudflareApiError extends Error {
  readonly code: string;
  readonly dependencies?: Record<string, number>;

  constructor(code: string, message: string, dependencies?: Record<string, number>) {
    super(message);
    this.name = 'CloudflareApiError';
    this.code = code;
    this.dependencies = dependencies;
  }
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;

  let payload: Record<string, unknown>;
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    throw new CloudflareApiError('INVALID_API_RESPONSE', 'پاسخ سرور قابل خواندن نیست.');
  }
  if (!response.ok) {
    const code = typeof payload.error === 'string' ? payload.error : 'REQUEST_FAILED';
    const dependencies = typeof payload.dependencies === 'object' && payload.dependencies !== null
      ? payload.dependencies as Record<string, number>
      : undefined;
    const messages: Record<string, string> = {
      UNAUTHORIZED: 'نشست ورود معتبر نیست؛ دوباره وارد شوید.',
      FORBIDDEN: 'دسترسی لازم برای این عملیات وجود ندارد.',
      CLIENT_NOT_FOUND: 'صاحب کالا پیدا نشد یا به آن دسترسی ندارید.',
      CLIENT_NATIONAL_ID_EXISTS: 'صاحب کالایی با این شناسه ملی از قبل ثبت شده است.',
      CLIENT_HAS_DEPENDENCIES: 'این صاحب کالا به اطلاعات عملیاتی وابسته است و حذف آن مجاز نیست.',
      CLIENT_DELETE_BLOCKED: 'به دلیل وجود وابستگی جدید، حذف انجام نشد.',
      CLIENTS_API_NOT_READY: 'سرویس صاحبان کالا یا Migration پایگاه داده هنوز آماده نیست.',
      INVALID_CLIENT_INPUT: 'نام، شناسه ملی یا یادداشت‌ها معتبر نیستند.',
      ORIGIN_FORBIDDEN: 'درخواست از مبدأ غیرمجاز ارسال شده است.',
    };
    throw new CloudflareApiError(code, messages[code] || 'عملیات انجام نشد: ' + code, dependencies);
  }
  return payload as T;
};

export const cloudflareClientsApi = {
  list: (options: { search?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', String(options.limit ?? 100));
    params.set('offset', String(options.offset ?? 0));
    if (options.search?.trim()) params.set('search', options.search.trim());
    return request<ClientListResponse>('/api/clients?' + params.toString());
  },
  create: (input: ClientInput) => request<{ ok: true; client: ClientRecord }>('/api/clients', {
    method: 'POST',
    body: JSON.stringify(input),
  }),
  update: (id: string, input: ClientInput) => request<{ ok: true; client: ClientRecord }>(
    '/api/clients/' + encodeURIComponent(id),
    { method: 'PATCH', body: JSON.stringify(input) },
  ),
  remove: (id: string) => request<void>('/api/clients/' + encodeURIComponent(id), { method: 'DELETE' }),
};
