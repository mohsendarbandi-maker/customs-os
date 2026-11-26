export interface DeclarationExitItem {
  key: 'warehouse_invoice_initial' | 'warehouse_invoice_supplement' | 'transport_power_of_attorney';
  label: string;
  completed: boolean;
}
export interface DeclarationChecklistItem {
  id: string;
  item_key: string;
  item_label: string;
  completed: boolean;
  note: string | null;
  sort_order: number;
  source: string;
  is_active: boolean;
}
export interface DeclarationExitResponse {
  ok: true;
  declaration: {
    id: string;
    organization_id: string;
    shipment_id: string | null;
    kottaj_number: string;
    customs_regime: string | null;
    customs_path: string | null;
    workflow_stage: number | null;
    sata_code: string | null;
    ship_passed: boolean | number | null;
    transport_documents_status: string | null;
    [key: string]: unknown;
  };
  workflow: Record<string, unknown> | null;
  exitItems: DeclarationExitItem[];
  checklistItems: DeclarationChecklistItem[];
  remainingChecklistItems: string[];
}
export interface DeclarationExitCompletion {
  ok: boolean;
  ready: boolean;
  issues?: string[];
  workflow_stage?: number;
  finance_status?: string;
  shipment_id?: string;
}
export class CloudflareDeclarationExitError extends Error {
  constructor(readonly code: string) {
    super(code === 'UNAUTHORIZED' ? 'نشست ورود معتبر نیست؛ دوباره وارد شوید.'
      : code === 'DECLARATION_NOT_FOUND' ? 'اظهارنامه پیدا نشد یا به این سازمان تعلق ندارد.'
      : code === 'FORBIDDEN' ? 'اجازه انجام این عملیات را ندارید.'
      : code === 'CHECKLIST_ITEM_NOT_FOUND' ? 'مورد چک‌لیست پیدا نشد.'
      : code === 'DECLARATION_SHIPMENT_REQUIRED' ? 'محموله مرتبط با اظهارنامه مشخص نیست.'
      : code === 'SHIPMENT_FINANCE_STATUS_COLUMN_MISSING' ? 'فیلد وضعیت مالی در ساختار D1 موجود نیست؛ تکمیل خروج متوقف شد.'
      : code === 'DECLARATION_EXIT_COMPLETION_FAILED' ? 'تکمیل خروج در پایگاه D1 انجام نشد؛ هیچ موفقیتی تأیید نشده است.'
      : 'عملیات درب خروج ناموفق بود: ' + code);
    this.name = 'CloudflareDeclarationExitError';
  }
}
async function call<T>(path: string, method = 'GET', body?: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CloudflareDeclarationExitError('NETWORK_UNAVAILABLE');
  }
  let data: Record<string, unknown>;
  try { data = await response.json() as Record<string, unknown>; }
  catch { throw new CloudflareDeclarationExitError('INVALID_API_RESPONSE'); }
  if (!response.ok || data.ok === false) {
    throw new CloudflareDeclarationExitError(typeof data.error === 'string' ? data.error : 'REQUEST_FAILED');
  }
  return data as T;
}
const base = (declarationId: string) => '/api/declarations/' + encodeURIComponent(declarationId) + '/exit';
export const cloudflareDeclarationExitApi = {
  get: (declarationId: string) => call<DeclarationExitResponse>(base(declarationId)),
  setExitItem: (declarationId: string, itemKey: DeclarationExitItem['key'], completed: boolean) =>
    call<{ ok: true; item: DeclarationExitItem }>(base(declarationId) + '/checklist', 'POST', {
      item_key: itemKey, completed,
    }),
  addChecklistItem: (declarationId: string, itemLabel: string, sortOrder: number) =>
    call<{ ok: true; item: DeclarationChecklistItem }>(base(declarationId) + '/items', 'POST', {
      item_label: itemLabel, sort_order: sortOrder,
    }),
  updateChecklistItem: (declarationId: string, itemId: string, patch: {
    completed?: boolean; note?: string | null; is_active?: boolean;
  }) => call<{ ok: true; item: DeclarationChecklistItem }>(
    base(declarationId) + '/items/' + encodeURIComponent(itemId), 'PATCH', patch,
  ),
  advance: (declarationId: string) => call<{
    ok: true; workflow_stage: number; partial_allowed: boolean; remaining_items: string[];
    learning: { hsCode: string; evidenceCount: number; confidence: number; active: boolean } | null;
  }>(base(declarationId) + '/advance', 'POST', {}),
  complete: (declarationId: string, sataCode: string) => call<DeclarationExitCompletion>(
    base(declarationId) + '/complete', 'POST', { sata_code: sataCode.trim() || null },
  ),
};
