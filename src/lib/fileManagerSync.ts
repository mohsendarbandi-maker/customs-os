const DB_NAME = 'customs-os-file-manager-sync';
const DB_VERSION = 1;
const STORE_NAME = 'settings';
const ROOT_HANDLE_KEY = 'organization-root-directory';

function openHandleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('ذخیرهٔ محل همگام‌سازی در این مرورگر در دسترس نیست.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('بازکردن فضای تنظیمات همگام‌سازی ناموفق بود.'));
  });
}

export async function saveSyncDirectoryHandle(handle: any): Promise<void> {
  const database = await openHandleDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(handle, ROOT_HANDLE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('ذخیرهٔ محل همگام‌سازی ناموفق بود.'));
      transaction.onabort = () => reject(transaction.error || new Error('ذخیرهٔ محل همگام‌سازی لغو شد.'));
    });
  } finally { database.close(); }
}

export async function getSavedSyncDirectoryHandle(): Promise<any | null> {
  const database = await openHandleDatabase();
  try {
    return await new Promise<any | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(ROOT_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('خواندن محل همگام‌سازی ناموفق بود.'));
    });
  } finally { database.close(); }
}

export async function clearSavedSyncDirectoryHandle(): Promise<void> {
  const database = await openHandleDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(ROOT_HANDLE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('حذف محل همگام‌سازی ناموفق بود.'));
      transaction.onabort = () => reject(transaction.error || new Error('حذف محل همگام‌سازی لغو شد.'));
    });
  } finally { database.close(); }
}

export async function requestSyncDirectoryPermission(handle: any): Promise<boolean> {
  if (!handle || typeof handle.requestPermission !== 'function') return false;
  const current = await handle.queryPermission?.({ mode: 'readwrite' });
  if (current === 'granted') return true;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join('، ') : '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
  return String(value);
}

const FIELD_LABELS: Record<string, string> = {
  name: 'نام', name_fa: 'نام فارسی', display_name: 'عنوان نمایشی', shipping_line: 'خط کشتیرانی',
  vessel_name: 'نام کشتی', imo_number: 'شماره IMO', mmsi_number: 'شماره MMSI', voyage_no: 'شماره سفر',
  bill_of_lading_no: 'شماره بارنامه', bill_of_lading: 'بارنامه', tally_no: 'شماره تالی',
  warehouse_receipt_no: 'شماره قبض انبار', warehouse_receipt_date: 'تاریخ قبض انبار',
  warehouse_receipt_date_shamsi: 'تاریخ قبض انبار (شمسی)', kottaj_number: 'شماره کوتاژ',
  registration_order_no: 'شماره ثبت سفارش', order_number: 'شماره ثبت سفارش',
  payment_instrument_code: 'کد ابزار پرداخت / اعتبار اسنادی', lc_number: 'شماره اعتبار اسنادی',
  sata_code: 'کد ساتا', customs_regime: 'رویه گمرکی', customs_path: 'مسیر گمرکی',
  case_number: 'شماره پرونده', proforma_no: 'شماره پروفرما', cargo_description: 'شرح کالا',
  cargo_count: 'تعداد کالا', cargo_count_unit: 'واحد تعداد', package_count: 'تعداد بسته',
  net_weight_kg: 'وزن خالص (کیلوگرم)', gross_weight_kg: 'وزن ناخالص (کیلوگرم)',
  origin_port: 'مبدأ بارگیری', destination_port: 'مقصد', origin_country: 'کشور مبدأ',
  transaction_country: 'کشور طرف معامله', delivery_term: 'اینکوترمز', tariff_code: 'کد تعرفه',
  invoice_amount: 'مبلغ فاکتور', invoice_currency: 'ارز فاکتور', currency: 'ارز',
  assessed_value_irr: 'ارزش ارزیابی‌شده (ریال)', total_duties_irr: 'جمع حقوق و عوارض (ریال)',
  import_duty_irr: 'حقوق ورودی (ریال)', vat_irr: 'مالیات بر ارزش افزوده (ریال)',
  total_payable_irr: 'مبلغ قابل پرداخت (ریال)', insurance_irr: 'بیمه (ریال)',
  insurance_amount_irr: 'مبلغ بیمه (ریال)', bank_name: 'نام بانک', bank_branch: 'شعبه بانک',
  bank_branch_code: 'کد شعبه', original_amount: 'مبلغ اصلی', original_currency: 'ارز اصلی',
  exchange_rate: 'نرخ تبدیل', base_amount_irr: 'مبلغ پایه (ریال)', transaction_type: 'نوع تراکنش',
  category: 'دسته مالی', transaction_date: 'تاریخ تراکنش', description: 'شرح تراکنش',
  source_type: 'نوع منبع تراکنش', source_id: 'شناسه منبع تراکنش', source_leg: 'بخش تراکنش',
  release_status: 'وضعیت ترخیص', current_status: 'وضعیت فعلی', current_location: 'موقعیت فعلی',
  eta_destination: 'زمان تخمینی رسیدن', etd_origin: 'زمان تخمینی حرکت',
  actual_departure_at: 'زمان واقعی حرکت', actual_arrival_at: 'زمان واقعی رسیدن',
  unloading_date: 'تاریخ تخلیه', declaration_date: 'تاریخ اظهارنامه',
  declaration_file_name: 'نام فایل اظهارنامه', document_type: 'نوع سند',
  document_number: 'شماره سند', issue_date: 'تاریخ صدور', issue_date_shamsi: 'تاریخ صدور (شمسی)',
  original_name: 'نام فایل اصلی', importer_name: 'نام واردکننده', exporter_name: 'نام صادرکننده',
  tags: 'برچسب‌ها', status: 'وضعیت', notes: 'یادداشت‌ها', address: 'نشانی', phone: 'تلفن',
  national_id: 'شناسه ملی', economic_code: 'کد اقتصادی', flag: 'پرچم',
  customs_fx_rate_irr: 'نرخ ارز گمرکی', customs_value_irr: 'ارزش گمرکی (ریال)',
  import_duty_rate: 'نرخ حقوق ورودی', duty_rate: 'نرخ حقوق ورودی', quantity: 'مقدار',
  quantity_unit: 'واحد مقدار', value_amount: 'ارزش ثبت سفارش', is_closed: 'بسته شده',
  final_settlement_required: 'نیازمند تسویه نهایی', final_settlement_status: 'وضعیت تسویه نهایی',
  final_settlement_amount_irr: 'مبلغ تسویه نهایی (ریال)',
  voucher_number: 'شماره سند حسابداری', company_name: 'نام شرکت', cargo_type: 'نوع کالا',
  tonnage: 'تناژ', unit_count: 'تعداد واحد', unit_type: 'نوع واحد', debit_total: 'جمع بدهکار',
  credit_total: 'جمع بستانکار', balance_total: 'مانده حساب', is_balanced: 'سند تراز است',
  invoice_no: 'شماره فاکتور', invoice_year: 'سال فاکتور', subtotal: 'جمع جزء',
  discount_amount: 'مبلغ تخفیف', total_amount: 'مبلغ کل', due_date: 'سررسید',
  payment_terms: 'شرایط پرداخت', public_note: 'یادداشت عمومی', internal_note: 'یادداشت داخلی',
  payment_no: 'شماره پرداخت', payment_date: 'تاریخ پرداخت', direction: 'جهت پرداخت',
  amount: 'مبلغ', amount_irr: 'مبلغ به ریال', method: 'روش پرداخت', reference_no: 'شماره پیگیری',
  account_last4: 'چهار رقم پایانی حساب', payment_type: 'نوع پرداخت', request_no: 'شماره درخواست پرداخت',
  request_date: 'تاریخ درخواست', requested_amount: 'مبلغ درخواستی', subject: 'موضوع',
  trigger_point: 'مرحله ایجاد درخواست', unit_price: 'قیمت واحد',
  payable_by: 'پرداخت‌کننده', billable: 'قابل صدور صورتحساب', reimbursable: 'قابل بازپرداخت',
  paid_by: 'پرداخت‌شده توسط', approval_status: 'وضعیت تأیید', workflow_status: 'وضعیت گردش کار',
  receipt_files: 'فایل‌های رسید', is_pass_through: 'هزینه عبوری',
  is_billable_default: 'قابل صدور صورتحساب به‌صورت پیش‌فرض', bank_account_name: 'نام صاحب حساب',
  bank_account_no: 'شماره حساب', iban: 'شماره شبا', default_currency: 'ارز پیش‌فرض',
  next_invoice_number: 'شماره بعدی فاکتور', next_payment_request_number: 'شماره بعدی درخواست پرداخت',
  receipt_mandatory_threshold_irr: 'آستانه الزام رسید (ریال)', cargo_entry_date: 'تاریخ ورود کالا',
  permit_issue_date: 'تاریخ صدور مجوز', cost_type: 'نوع هزینه',
  cost_category: 'دسته هزینه', occurred_at: 'زمان وقوع هزینه', vat_rate: 'نرخ مالیات',
  vat_amount: 'مبلغ مالیات', payment_request_prefix: 'پیشوند درخواست پرداخت',

};

function formatRecord(record: Record<string, unknown> | null | undefined): string {
  if (!record) return 'اطلاعاتی ثبت نشده است.';
  return Object.entries(record)
    .filter(([key, value]) => !['organization_id', 'file_manager_search_text'].includes(key) && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => '• ' + (FIELD_LABELS[key] || key) + ': ' + formatMetadataValue(value))
    .join('\n') || 'اطلاعاتی ثبت نشده است.';
}

export type FolderSyncMetadata = {
  folder: { id: string; display_name: string; folder_type: string; client_id: string | null; shipment_id: string | null };
  client?: Record<string, unknown> | null;
  shipment?: Record<string, unknown> | null;
  customsData?: Record<string, unknown> | null;
  caseRecord?: Record<string, unknown> | null;
  vessel?: Record<string, unknown> | null;
  shippingLine?: Record<string, unknown> | null;
  customsOffice?: Record<string, unknown> | null;
  registrationOrder?: Record<string, unknown> | null;
  declarations?: Record<string, unknown>[];
  financialTransactions?: Record<string, unknown>[];
  documents?: Record<string, unknown>[];
  relatedSections?: Array<{ title: string; records: Record<string, unknown>[] }>;
  generatedAt?: string;
};

export function buildFolderMetadataText(input: FolderSyncMetadata): string {
  const sections: Array<[string, Record<string, unknown> | null | undefined]> = [
    ['مشخصات پوشه', {
      'نام پوشه': input.folder.display_name,
      'نوع پوشه': input.folder.folder_type,
      'شناسه پوشه': input.folder.id,
      'شناسه صاحب کالا': input.folder.client_id,
      'شناسه محموله': input.folder.shipment_id,
      'زمان تهیه': input.generatedAt || new Date().toISOString(),
    }],
    ['صاحب کالا', input.client],
    ['محموله و اطلاعات حمل', input.shipment],
    ['اطلاعات عملیات گمرکی', input.customsData],
    ['پرونده و ثبت سفارش', input.caseRecord],
    ['کشتی', input.vessel],
    ['خط کشتیرانی', input.shippingLine],
    ['گمرک', input.customsOffice],
    ['مشخصات ثبت سفارش و بانک', input.registrationOrder],
  ];
  const output = [
    'DAR BANDI COMMERCIAL — پروندهٔ اطلاعاتی فایل‌منیجر',
    'این فایل به‌صورت خودکار از اطلاعات ثبت‌شده در Customs OS تهیه شده است.',
    'مقادیر خالی با «—» نمایش داده می‌شوند؛ اطلاعات ثبت‌نشده حدس زده نشده‌اند.',
    '',
  ];
  for (const [title, record] of sections) {
    output.push('========== ' + title + ' ==========');
    output.push(formatRecord(record));
    output.push('');
  }
  output.push('========== اظهارنامه‌ها و کوتاژها ==========');
  output.push(input.declarations?.length
    ? input.declarations.map((item, index) => '--- اظهارنامه ' + (index + 1) + ' ---\n' + formatRecord(item)).join('\n\n')
    : 'اظهارنامه‌ای ثبت نشده است.');
  output.push('');
  output.push('========== گردش حساب و تراکنش‌های مالی ==========');
  output.push(input.financialTransactions?.length
    ? input.financialTransactions.map((item, index) => '--- تراکنش ' + (index + 1) + ' ---\n' + formatRecord(item)).join('\n\n')
    : 'تراکنش مالی مرتبطی ثبت نشده است.');
  output.push('');
  for (const section of input.relatedSections || []) {
    output.push('========== ' + section.title + ' ==========');
    output.push(section.records.length
      ? section.records.map((item, index) => '--- مورد ' + (index + 1) + ' ---\n' + formatRecord(item)).join('\n\n')
      : 'موردی ثبت نشده است.');
    output.push('');
  }
  output.push('========== مشخصات اسناد این پوشه ==========');
  output.push(input.documents?.length
    ? input.documents.map((item, index) => '--- سند ' + (index + 1) + ' ---\n' + formatRecord(item)).join('\n\n')
    : 'سندی در این پوشه ثبت نشده است.');
  return output.join('\n');
}

export function buildDocumentMetadataText(file: Record<string, unknown>, folderText: string): string {
  return [
    '========== مشخصات اختصاصی این سند ==========',
    formatRecord(file),
    '',
    '========== اطلاعات محموله، کشتیرانی، گمرک و مالی مرتبط ==========',
    folderText,
  ].join('\n');
}

export function isManagedSyncMetadataFile(name: string): boolean {
  return name === 'اطلاعات_کامل_سازمان.json' || name === 'اطلاعات_عملیاتی.txt' || name.endsWith('.اطلاعات.txt');
}
