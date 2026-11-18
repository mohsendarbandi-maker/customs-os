export type CustomsStageField = {
  key: string;
  label: string;
  required?: boolean;
  type?: string;
  kind?: string;
  options?: { value: string; label: string }[];
};
export type CustomsDocumentType =
  | 'PROFORMA_INVOICE' | 'COMMERCIAL_INVOICE' | 'PACKING_LIST' | 'BILL_OF_LADING'
  | 'DELIVERY_ORDER' | 'EPL_DELIVERY_ORDER' | 'WAREHOUSE_RECEIPT' | 'IMPORT_LICENSE'
  | 'SATA_PAYMENT_DOC' | 'INSURANCE_POLICY' | 'CERTIFICATE_OF_ORIGIN'
  | 'INSPECTION_CERTIFICATE' | 'TECHNICAL_SPEC_CATALOG' | 'POWER_OF_ATTORNEY'
  | 'CUSTOMS_DECLARATION_PRINT';
export const CUSTOMS_DOCUMENT_TYPE_OPTIONS: { value: CustomsDocumentType; label: string }[] = [
  { value: 'PROFORMA_INVOICE', label: 'پروفرما' },
  { value: 'COMMERCIAL_INVOICE', label: 'فاکتور تجاری' },
  { value: 'PACKING_LIST', label: 'پکینگ لیست' },
  { value: 'BILL_OF_LADING', label: 'بارنامه / B/L' },
  { value: 'DELIVERY_ORDER', label: 'ترخیصیه' },
  { value: 'EPL_DELIVERY_ORDER', label: 'ترخیصیه EPL' },
  { value: 'WAREHOUSE_RECEIPT', label: 'قبض انبار' },
  { value: 'IMPORT_LICENSE', label: 'ثبت سفارش' },
  { value: 'SATA_PAYMENT_DOC', label: 'اسناد ساتا / منشأ ارز' },
  { value: 'INSURANCE_POLICY', label: 'بیمه‌نامه' },
  { value: 'CERTIFICATE_OF_ORIGIN', label: 'گواهی مبدأ' },
  { value: 'INSPECTION_CERTIFICATE', label: 'گواهی بازرسی' },
  { value: 'TECHNICAL_SPEC_CATALOG', label: 'آنالیز / کاتالوگ' },
  { value: 'POWER_OF_ATTORNEY', label: 'وکالت‌نامه' },
  { value: 'CUSTOMS_DECLARATION_PRINT', label: 'اظهارنامه / کوتاژ' },
];
export const CUSTOMS_OPERATION_STAGE_LABELS: Record<string, string> = {
  documents: 'اسناد و مشخصات',
  evaluation: 'ارزیابی',
  expertise: 'کارشناسی و مجوزها',
  permits: 'مجوزها',
  cashier: 'صندوق و ضمانت‌نامه',
  loading_permit: 'مجوز بارگیری و منشأ ارز',
  declaration: 'اظهار و ثبت',
  valuation: 'ارزش و تعهدات',
  guarantee: 'تضمین و تعهدات',
  use_period: 'دوره استفاده / پردازش',
  loading: 'آماده‌سازی و بارگیری',
  exit: 'درب خروج',
  re_export: 'خروج مجدد / تعیین تکلیف',
  port_charges: 'عوارض بندری',
  completed: 'بازبینی نهایی',
  abandoned: 'متروکه',
};
export const DEFAULT_CUSTOMS_STAGE_FIELDS: Record<string, CustomsStageField[]> = {
  evaluation: [
    { key: 'status', label: 'وضعیت ارزیابی' },
    { key: 'evaluator_number', label: 'شماره ارزیاب' },
    { key: 'expert_requested', label: 'درخواست ارزیابی توسط کارشناس', type: 'boolean' },
    { key: 'expert_request_note', label: 'توضیح / نتیجه ارزیابی' },
  ],
  expertise: [
    { key: 'appointment_status', label: 'وضعیت نوبت کارشناسی' },
    { key: 'appointment_number', label: 'شماره نوبت / مرجع' },
    { key: 'road_authority_status', label: 'وضعیت راهداری' },
    { key: 'plant_quarantine_status', label: 'وضعیت قرنطینه / حفظ نباتات' },
    { key: 'standard_expert_review', label: 'بررسی کارشناس استاندارد' },
    { key: 'standard_inspection_status', label: 'وضعیت بازرسی / نمونه‌گیری' },
    { key: 'standard_inspection_company', label: 'شرکت بازرسی' },
    { key: 'standard_laboratory', label: 'آزمایشگاه' },
    { key: 'standard_standard_fee', label: 'کارمزد استاندارد' },
  ],
  cashier: [
    { key: 'method', label: 'روش تسویه' },
    { key: 'cash_paid_irr', label: 'مبلغ پرداخت نقدی (ریال)', type: 'number' },
    { key: 'guarantee_duties', label: 'ضمانت حقوق ورودی', type: 'boolean' },
    { key: 'guarantee_vat', label: 'ضمانت مالیات بر ارزش افزوده', type: 'boolean' },
    { key: 'guarantee_reference', label: 'شماره ضمانت‌نامه / مرجع پرداخت' },
  ],
  loading_permit: [
    { key: 'clause2_request_status', label: 'وضعیت درخواست تبصره ۲' },
    { key: 'tax_permission_status', label: 'وضعیت مجوز مالیاتی' },
    { key: 'central_bank_status', label: 'وضعیت مجوز بانک مرکزی / منشأ ارز' },
    { key: 'sata_code', label: 'کد ساتا' },
    { key: 'clearance_90_percent_requested', label: 'درخواست ترخیص ۹۰ درصدی', type: 'boolean' },
    { key: 'comment', label: 'توضیح درخواست / پاسخ' },
  ],
  exit: [
    { key: 'loading_permission_status', label: 'وضعیت اجازه بارگیری' },
    { key: 'financial_registration_status', label: 'وضعیت ثبت مالی' },
    { key: 'weighbridge_required', label: 'نیاز به باسکول / دیماند', type: 'boolean' },
    { key: 'weighbridge_demand_irr', label: 'مبلغ دیماند باسکول (ریال)', type: 'number' },
    { key: 'weighbridge_paid', label: 'پرداخت باسکول', type: 'boolean' },
    { key: 'loading_completed_at', label: 'زمان اتمام بارگیری' },
  ],
  port_charges: [
    { key: 'insurance_policy_no', label: 'شماره بیمه‌نامه' },
    { key: 'insurance_issue_date', label: 'تاریخ صدور بیمه‌نامه' },
    { key: 'warehouse_receipt_date', label: 'تاریخ قبض انبار' },
    { key: 'initial_invoice_status', label: 'وضعیت صورتحساب اولیه' },
    { key: 'transport_power_of_attorney_status', label: 'وضعیت وکالت حمل' },
    { key: 'loading_form_received_at', label: 'تاریخ دریافت فرم بارگیری' },
    { key: 'loading_started_at', label: 'تاریخ شروع بارگیری' },
    { key: 'supplemental_invoice_status', label: 'وضعیت صورتحساب تکمیلی' },
    { key: 'last_truck_loaded_at', label: 'تاریخ آخرین کامیون' },
  ],
  documents: [
    { key: 'invoiceNo', label: 'شماره فاکتور / پروفرما' },
    { key: 'goodsDescription', label: 'شرح کالا' },
    { key: 'hsCode', label: 'کد تعرفه HS' },
    { key: 'quantity', label: 'مقدار کالا', type: 'number' },
    { key: 'unit', label: 'واحد اندازه‌گیری' },
    { key: 'documentReferences', label: 'مراجع اسناد پیوست' },
  ],
  permits: [
    { key: 'status', label: 'وضعیت مجوز' },
    { key: 'authority', label: 'مرجع صادرکننده' },
    { key: 'permitReference', label: 'شماره / مرجع مجوز' },
  ],
  declaration: [
    { key: 'kottajNumber', label: 'شماره کوتاژ' },
    { key: 'declarationDate', label: 'تاریخ اظهار شمسی' },
    { key: 'officeReference', label: 'گمرک / مرجع محل انجام' },
  ],
  valuation: [
    { key: 'value', label: 'ارزش اظهارشده', type: 'number' },
    { key: 'currency', label: 'ارز' },
    { key: 'exchangeRate', label: 'نرخ تسعیر', type: 'number' },
    { key: 'guaranteeStatus', label: 'وضعیت تضمین' },
    { key: 'guaranteeReference', label: 'مرجع تضمین' },
  ],
  loading: [
    { key: 'loadingFormNumber', label: 'شماره فرم بارگیری' },
    { key: 'loadingDate', label: 'تاریخ بارگیری' },
    { key: 'loadedQuantity', label: 'مقدار بارگیری‌شده', type: 'number' },
  ],
  guarantee: [
    { key: 'type', label: 'نوع تضمین' },
    { key: 'amount', label: 'مبلغ تضمین', type: 'number' },
    { key: 'currency', label: 'ارز تضمین' },
    { key: 'reference', label: 'مرجع تضمین' },
    { key: 'status', label: 'وضعیت تضمین' },
  ],
  use_period: [
    { key: 'startDate', label: 'تاریخ شروع دوره' },
    { key: 'endDate', label: 'تاریخ پایان مجاز' },
    { key: 'useStatus', label: 'وضعیت استفاده / پردازش' },
    { key: 'processingDescription', label: 'شرح پردازش' },
  ],
  re_export: [
    { key: 'resolution', label: 'تعیین تکلیف' },
    { key: 'reExportDeclaration', label: 'شماره اظهار خروج مجدد' },
    { key: 'reExportDate', label: 'تاریخ خروج مجدد' },
    { key: 'evidenceReferences', label: 'مراجع اسناد اثبات انجام تعهد' },
  ],
  abandoned: [
    { key: 'warehouse_receipt_date', label: 'تاریخ قبض انبار' },
    { key: 'loading_form_received_at', label: 'تاریخ دریافت فرم بارگیری' },
    { key: 'followup_status', label: 'وضعیت پیگیری متروکه' },
    { key: 'notes', label: 'اقدام انجام‌شده و توضیحات' },
  ],
  completed: [
    { key: 'closureReference', label: 'مرجع تأیید نهایی' },
    { key: 'closureNote', label: 'یادداشت بستن پرونده' },
  ],
};
export function normalizeCustomsExtractionAnswer(payload: any): Record<string, unknown> {
  const raw = payload?.answer ?? payload?.message ?? payload;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  let text = String(raw ?? '').trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '');
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    }
  }
  throw new Error('پاسخ هوش مصنوعی ساختار JSON معتبر نداشت.');
}
