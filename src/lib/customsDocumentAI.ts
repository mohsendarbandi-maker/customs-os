export const CUSTOMS_OPERATION_SECTIONS = {
  evaluation: { label: 'ارزیابی', fields: [
    ['evaluator_number','شماره ارزیاب'],['evaluation_status','وضعیت ارزیابی'],['evaluation_result','نتیجه ارزیابی'],['assessed_value','ارزش ارزیابی‌شده'],['duty_amount','حقوق و عوارض محاسبه‌شده'],['inspection_date','تاریخ ارزیابی'],['inspection_notes','توضیحات ارزیابی'],
  ] },
  expertise: { label: 'کارشناسی و مجوزها', fields: [
    ['appointment_number','شماره نوبت کارشناسی'],['appointment_date','تاریخ نوبت'],['inspection_company','شرکت بازرسی'],['laboratory','آزمایشگاه'],['standard_status','وضعیت استاندارد'],['sample_status','وضعیت نمونه'],['inspection_fee','هزینه بازرسی'],['standard_fee','هزینه استاندارد'],['plant_quarantine_status','وضعیت قرنطینه نباتی'],['road_authority_status','وضعیت مجوز راه و شهرسازی'],['expert_review','نتیجه کارشناسی'],
  ] },
  cashier: { label: 'صندوق', fields: [
    ['receipt_number','شماره قبض پرداخت'],['payment_reference','شناسه پرداخت'],['paid_amount','مبلغ پرداخت‌شده'],['currency','ارز'],['payment_date','تاریخ پرداخت'],['guarantee_reference','شماره ضمانت‌نامه'],['cash_paid_irr','مبلغ نقدی پرداخت‌شده (ریال)'],['guarantee_duties','وضعیت ضمانت حقوق گمرکی'],['guarantee_vat','وضعیت ضمانت مالیات بر ارزش افزوده'],
  ] },
  loading_permit: { label: 'مجوز بارگیری', fields: [
    ['sata_code','کد ساتا'],['central_bank_status','وضعیت بانک مرکزی'],['tax_permission_status','وضعیت مجوز مالیاتی'],['clause2_request_status','وضعیت درخواست تبصره ۲'],['clearance_90_percent_requested','درخواست ترخیص ۹۰ درصد'],['loading_permission_number','شماره مجوز بارگیری'],['permission_date','تاریخ مجوز بارگیری'],['comment','توضیحات مجوز بارگیری'],
  ] },
  exit: { label: 'درب خروج', fields: [
    ['loading_permission_status','وضعیت مجوز خروج/بارگیری'],['financial_registration_status','وضعیت ثبت مالی'],['weighbridge_required','نیاز به باسکول'],['weighbridge_paid','وضعیت پرداخت باسکول'],['weighbridge_demand_irr','مبلغ مطالبه باسکول'],['loading_completed_at','تاریخ تکمیل بارگیری'],['exit_permit_number','شماره مجوز خروج'],['truck_plate','شماره پلاک کامیون'],['exit_date','تاریخ خروج'],
  ] },
  port_charges: { label: 'عوارض بندری', fields: [
    ['warehouse_receipt_no','شماره قبض انبار'],['warehouse_receipt_date','تاریخ قبض انبار'],['insurance_policy_no','شماره بیمه‌نامه'],['insurance_issue_date','تاریخ صدور بیمه‌نامه'],['loading_form_received_at','تاریخ دریافت فرم بارگیری'],['loading_started_at','تاریخ شروع بارگیری'],['last_truck_loaded_at','تاریخ بارگیری آخرین کامیون'],['initial_invoice_status','وضعیت صورتحساب اولیه'],['supplemental_invoice_status','وضعیت صورتحساب متمم'],['transport_power_of_attorney_status','وضعیت وکالت حمل'],['port_charge_amount','مبلغ عوارض بندری'],['port_charge_receipt_no','شماره رسید عوارض بندری'],
  ] },
} as const;

export type CustomsOperationSection = keyof typeof CUSTOMS_OPERATION_SECTIONS;
export const CUSTOMS_OPERATION_SECTION_KEYS = Object.keys(CUSTOMS_OPERATION_SECTIONS) as CustomsOperationSection[];

export const isCustomsDocumentAssignedToSection = (operationSections: string[] | null | undefined, section: CustomsOperationSection) =>
  Array.isArray(operationSections) && operationSections.includes(section);

export const customsOperationFieldSchema = (section: CustomsOperationSection) =>
  CUSTOMS_OPERATION_SECTIONS[section].fields.map(([key,label]) => ({
    key, label, type: 'text', required: false,
  }));

export const parseCustomsDocumentExtraction = (raw: string, section: CustomsOperationSection): Record<string,string> => {
  const cleaned = String(raw || '').replace(/^`{3}(?:json)?\s*/i, '').replace(/\s*`{3}$/,'').trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('پاسخ هوش مصنوعی ساختار JSON معتبر ندارد.');
  }
  const allowed = new Set(customsOperationFieldSchema(section).map((field) => field.key));
  return Object.fromEntries(Object.entries(parsed as Record<string,unknown>)
    .filter(([key]) => allowed.has(key))
    .map(([key,value]) => [key, value == null ? '' : String(value).trim()])
    .filter(([,value]) => value !== ''));
};
