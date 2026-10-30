export type JalaliDateParts = { year: number; month: number; day: number };

export type AbandonedGoodsDates = {
  loadingFormReceivedAt?: string | null;
  loadingCompletedAt?: string | null;
  warehouseReceiptAt?: string | null;
  loadingStartedAt?: string | null;
};

export type AbandonedGoodsWarnings = {
  loadingFormExpired: boolean;
  receiptExpired: boolean;
  any: boolean;
};

const persianDateFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'Asia/Tehran',
});

const asciiDigits = (value: string): string =>
  value
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

const partsForGregorianDate = (date: Date): JalaliDateParts => {
  const parts = persianDateFormatter.formatToParts(date);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value || 0);
  return { year: get('year'), month: get('month'), day: get('day') };
};

const sameDate = (left: JalaliDateParts, right: JalaliDateParts): boolean =>
  left.year === right.year && left.month === right.month && left.day === right.day;

/**
 * Converts a Jalali date to a stable UTC-noon Gregorian Date.
 * UTC noon avoids day changes caused by the device's local time zone.
 */
const jalaliPartsToGregorian = (target: JalaliDateParts): Date | null => {
  if (
    !Number.isInteger(target.year) ||
    target.year < 1200 ||
    target.year > 1600 ||
    !Number.isInteger(target.month) ||
    target.month < 1 ||
    target.month > 12 ||
    !Number.isInteger(target.day) ||
    target.day < 1 ||
    target.day > 31
  ) return null;

  const candidate = new Date(Date.UTC(target.year + 621, 2, 1, 12));
  for (let offset = 0; offset < 400; offset += 1) {
    const parts = partsForGregorianDate(candidate);
    if (sameDate(parts, target)) {
      return new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate(), 12));
    }
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return null;
};

export const parseJalaliDate = (value: string | null | undefined): JalaliDateParts | null => {
  const normalized = asciiDigits(String(value || '').trim()).replace(/[.-]/g, '/');
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;

  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return jalaliPartsToGregorian(parts) ? parts : null;
};

export const formatJalaliDate = (parts: JalaliDateParts): string =>
  `${parts.year}/${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}`;

export const addJalaliMonths = (value: string | null | undefined, months: number): string | null => {
  const source = parseJalaliDate(value);
  if (!source || !Number.isInteger(months)) return null;

  const absoluteMonth = source.year * 12 + (source.month - 1) + months;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = ((absoluteMonth % 12) + 12) % 12 + 1;

  // Clamp to the final day of the target Jalali month (for example, 31 Shahrivar
  // plus one month becomes 30 Mehr rather than overflowing into Aban).
  for (let day = source.day; day >= 1; day -= 1) {
    const candidate = { year: targetYear, month: targetMonth, day };
    if (jalaliPartsToGregorian(candidate)) return formatJalaliDate(candidate);
  }
  return null;
};

const compareParts = (left: JalaliDateParts, right: JalaliDateParts): number => {
  if (left.year !== right.year) return left.year < right.year ? -1 : 1;
  if (left.month !== right.month) return left.month < right.month ? -1 : 1;
  if (left.day !== right.day) return left.day < right.day ? -1 : 1;
  return 0;
};

export const compareJalaliDates = (
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
): number | null => {
  const left = parseJalaliDate(leftValue);
  const right = parseJalaliDate(rightValue);
  return left && right ? compareParts(left, right) : null;
};

/** The due day is considered overdue beginning on its matching Tehran calendar day. */
export const isJalaliDeadlinePassed = (
  value: string | null | undefined,
  months: number,
  now: Date = new Date(),
): boolean => {
  const deadline = addJalaliMonths(value, months);
  const deadlineParts = parseJalaliDate(deadline);
  if (!deadlineParts) return false;
  return compareParts(partsForGregorianDate(now), deadlineParts) >= 0;
};

export const getAbandonedGoodsWarnings = (
  dates: AbandonedGoodsDates,
  now: Date = new Date(),
): AbandonedGoodsWarnings => {
  const loadingFormExpired = Boolean(
    dates.loadingFormReceivedAt &&
    !dates.loadingCompletedAt &&
    isJalaliDeadlinePassed(dates.loadingFormReceivedAt, 1, now),
  );
  const receiptExpired = Boolean(
    dates.warehouseReceiptAt &&
    !dates.loadingStartedAt &&
    isJalaliDeadlinePassed(dates.warehouseReceiptAt, 3, now),
  );

  return { loadingFormExpired, receiptExpired, any: loadingFormExpired || receiptExpired };
};


export type CustomsWorkflowValidationState = {
  customsPath: string;
  evaluation: Record<string, unknown>;
  expertise: Record<string, unknown>;
  cashier: Record<string, unknown>;
  loadingPermit: Record<string, unknown>;
  exit: Record<string, unknown>;
  port: Record<string, unknown>;
};

const textValue = (value: unknown): string => String(value ?? '').trim();
const boolValue = (value: unknown): boolean => value === true || value === 'true';
const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const oneOf = (value: unknown, allowed: string[]): boolean => allowed.includes(textValue(value));
const hasRecordedAmount = (value: unknown): boolean => {
  const raw = textValue(value).replace(/[\s,٬，]/g, '');
  if (!raw) return false;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0;
};
 
/** Green routes do not display an assessment step unless customs requests one. */
export const shouldShowAssessmentStage = (
  customsPath: string | null | undefined,
  evaluation: Record<string, unknown> | null | undefined,
): boolean => {
  const path = textValue(customsPath).toLowerCase();
  if (path !== 'green') return true;
  const state = recordValue(evaluation);
  return boolValue(state.expert_requested) || !oneOf(state.status, ['', 'not_required']);
};

/** Move stale default assessment stage to expertise on routes where it is not applicable. */
export const getInitialCustomsWorkflowStage = (
  currentStage: string | null | undefined,
  customsPath: string | null | undefined,
  evaluation: Record<string, unknown> | null | undefined,
): string => {
  const current = textValue(currentStage) || 'evaluation';
  return current === 'evaluation' && !shouldShowAssessmentStage(customsPath, evaluation)
    ? 'expertise'
    : current;
};


/**
 * Returns Persian blocker messages for the specified stage. A stage is checked
 * only when the operator attempts to advance past it, so users can still open
 * and edit earlier stages without a dead-end.
 */
export const getWorkflowStageIssues = (
  stage: string,
  state: CustomsWorkflowValidationState,
): string[] => {
  const issues: string[] = [];

  if (stage === 'evaluation') {
    const evaluation = state.evaluation;
    const status = textValue(evaluation.status);
    const requested = boolValue(evaluation.expert_requested);
    const required = state.customsPath === 'red' || requested || oneOf(status, ['required', 'in_progress']);
    if (required && status !== 'completed') {
      issues.push('ارزیابی الزامی است؛ نتیجه ارزیابی را تکمیل کنید.');
    }
    if (required && status === 'completed' && textValue(evaluation.evaluator_number) === '') {
      issues.push('شماره ارزیاب را ثبت کنید.');
    }
    return issues;
  }

  if (stage === 'expertise') {
    const expertise = state.expertise;
    const standard = recordValue(expertise.standard);

    if (!oneOf(expertise.appointment_status, ['scheduled', 'completed'])) {
      issues.push('نوبت کارشناسی باید دریافت یا کارشناسی تکمیل شود.');
    }
    if (!oneOf(expertise.road_authority_status, ['approved', 'not_required', 'completed'])) {
      issues.push('وضعیت مجوز راهداری باید تعیین تکلیف شود.');
    }
    if (!oneOf(expertise.plant_quarantine_status, ['approved', 'not_required', 'completed'])) {
      issues.push('وضعیت حفظ نباتات/قرنطینه باید تعیین تکلیف شود.');
    }

    if (!oneOf(standard.expert_review, ['approved', 'not_required'])) {
      issues.push('بررسی کارشناس استاندارد هنوز تأیید یا از شمول خارج نشده است.');
    }
    if (!oneOf(standard.expert_review, ['not_required'])) {
      const inspectionRequired = !oneOf(standard.inspection_status, ['not_required']);
      if (inspectionRequired && !oneOf(standard.inspection_status, ['sampled', 'completed'])) {
        issues.push('بازدید یا نمونه‌گیری شرکت بازرسی باید تکمیل یا غیرلازم ثبت شود.');
      }
      if (inspectionRequired && !hasRecordedAmount(standard.inspection_fee)) {
        issues.push('مبلغ هزینه بازرسی را ثبت کنید؛ در صورت رایگان بودن، صفر وارد کنید.');
      }
      if (inspectionRequired && !boolValue(standard.inspection_paid)) {
        issues.push('هزینه بازرسی باید پرداخت شود.');
      }
      if (inspectionRequired) {
        const invoiceStatus = textValue(standard.inspection_invoice_status) ||
          (boolValue(standard.inspection_invoice_received) ? 'received' : 'pending');
        if (!oneOf(invoiceStatus, ['received', 'not_issued', 'not_required'])) {
          issues.push('وضعیت دریافت یا صادرنشدن فاکتور بازرسی را مشخص کنید.');
        }
      }
      const sampleRequired = !oneOf(standard.sample_status, ['not_required']);
      if (sampleRequired && !oneOf(standard.sample_status, ['received'])) {
        issues.push('نتیجه آزمایش نمونه باید دریافت شود یا صریحاً غیرلازم ثبت شود.');
      }
      if (sampleRequired && !boolValue(standard.results_uploaded)) {
        issues.push('نتایج آزمایش باید در سامانه استاندارد بارگذاری شود.');
      }
      if (!hasRecordedAmount(standard.standard_fee)) {
        issues.push('مبلغ کارمزد استاندارد را ثبت کنید؛ اگر مبلغ صفر است، صفر وارد کنید.');
      }
      if (!boolValue(standard.standard_fee_paid)) {
        issues.push('پرداخت کارمزد استاندارد باید ثبت شود.');
      }
      if (!boolValue(standard.standard_notified)) {
        issues.push('اطلاع‌رسانی پرداخت به استاندارد باید ثبت شود.');
      }
    }
    return issues;
  }

  if (stage === 'cashier') {
    const cashier = state.cashier;
    const method = textValue(cashier.method);
    const amount = textValue(cashier.cash_paid_irr);
    const hasCashAmount = amount !== '' && Number.isFinite(Number(amount)) && Number(amount) >= 0;
    const hasGuarantee = boolValue(cashier.guarantee_duties) || boolValue(cashier.guarantee_vat);
    const hasGuaranteeReference = textValue(cashier.guarantee_reference) !== '';

    if (method === 'cash' && !hasCashAmount) {
      issues.push('مبلغ پرداخت نقدی صندوق را ثبت کنید.');
    } else if (method === 'bank_guarantee' && (!hasGuarantee || !hasGuaranteeReference)) {
      issues.push('نوع ضمانت‌نامه (حقوق ورودی/ارزش افزوده) و شماره مرجع آن را ثبت کنید.');
    } else if (method === 'mixed' && (!hasCashAmount || !hasGuarantee || !hasGuaranteeReference)) {
      issues.push('برای تسویه ترکیبی، مبلغ نقدی، نوع ضمانت‌نامه و شماره مرجع آن را ثبت کنید.');
    } else if (!oneOf(method, ['cash', 'bank_guarantee', 'mixed'])) {
      issues.push('روش تسویه صندوق را انتخاب کنید.');
    }
    return issues;
  }

  if (stage === 'loading_permit') {
    const permit = state.loadingPermit;
    const clause2Ready = oneOf(permit.clause2_request_status, ['approved', 'not_required']);
    const taxReady = oneOf(permit.tax_permission_status, ['approved', 'not_required']);
    const sataCode = textValue(permit.sata_code);
    const ninetyPercentRequest = boolValue(permit.clearance_90_percent_requested);
    const ninetyPercentReady = ninetyPercentRequest && !sataCode && textValue(permit.comment) !== '';
    const centralBankReady = oneOf(permit.central_bank_status, ['approved', 'not_required']) || ninetyPercentReady;

    if (!clause2Ready) issues.push('درخواست تبصره ۲ منطقه آزاد باید تأیید یا صریحاً غیرلازم ثبت شود.');
    if (!taxReady) issues.push('مجوز سازمان امور مالیاتی باید صادر یا غیرلازم ثبت شود.');
    if (!centralBankReady) {
      issues.push('وضعیت منشأ ارز/بانک مرکزی را تأیید کنید؛ در نبود ساتا، درخواست ترخیص ۹۰ درصدی و توضیح آن را ثبت کنید.');
    }
    return issues;
  }

  if (stage === 'exit') {
    const exit = state.exit;
    const permit = state.loadingPermit;
    const sataCode = textValue(permit.sata_code);
    const sataNotRequired = oneOf(permit.central_bank_status, ['not_required'])
      || (boolValue(permit.clearance_90_percent_requested) && textValue(permit.comment) !== '');
    if (!sataCode && !sataNotRequired) {
      issues.push('کد ساتا را برای خروج نهایی ثبت کنید؛ در صورت عدم نیاز به ساتا، وضعیت بانک مرکزی را «نیازی نیست» انتخاب کنید.');
    }
    if (textValue(exit.loading_permission_status) !== 'approved') {
      issues.push('اجازه بارگیری در درب خروج هنوز صادر نشده است.');
    }
    if (textValue(exit.financial_registration_status) !== 'registered') {
      issues.push('ثبت مالی در درب خروج تکمیل نشده است.');
    }
    if (boolValue(exit.weighbridge_required) && textValue(exit.loading_completed_at) && !boolValue(exit.weighbridge_paid)) {
      issues.push('دیماند باسکول پس از اتمام بارگیری باید پرداخت و ثبت شود.');
    }
    return issues;
  }

  if (stage === 'port_charges') {
    const port = state.port;
    const receiptDate = textValue(port.warehouse_receipt_date);
    const insuranceDate = textValue(port.insurance_issue_date);
    if (!parseJalaliDate(receiptDate)) issues.push('تاریخ معتبر قبض انبار را ثبت کنید.');
    if (!parseJalaliDate(insuranceDate)) issues.push('تاریخ معتبر بیمه‌نامه را ثبت کنید.');

    const insuranceVsReceipt = compareJalaliDates(insuranceDate, receiptDate);
    if (insuranceVsReceipt !== null && insuranceVsReceipt >= 0 &&
      !oneOf(port.insurance_followup_status, ['completed', 'not_required'])) {
      issues.push('بیمه‌نامه قبل از قبض انبار نیست؛ پیگیری بیمه/پوشش تکمیلی را تکمیل کنید.');
    }

    if (!oneOf(port.initial_invoice_status, ['received', 'paid', 'not_required'])) {
      issues.push('وضعیت صورتحساب اولیه باید دریافت، پرداخت یا عدم نیاز ثبت شود.');
    }
    if (!oneOf(port.transport_power_of_attorney_status, ['received', 'approved', 'not_required'])) {
      issues.push('وکالت حمل باید دریافت/تأیید یا عدم نیاز آن ثبت شود.');
    }
    if (!parseJalaliDate(textValue(port.loading_form_received_at))) {
      issues.push('تاریخ دریافت فرم بارگیری را ثبت کنید.');
    }
    if (!parseJalaliDate(textValue(state.exit.loading_completed_at))) {
      issues.push('تاریخ اتمام بارگیری را در مرحله درب خروج ثبت کنید.');
    }
    if (textValue(port.last_truck_loaded_at) &&
      !oneOf(port.supplemental_invoice_status, ['received', 'paid'])) {
      issues.push('با ثبت بارگیری کامیون آخر، دریافت یا پرداخت صورتحساب متمم را ثبت کنید.');
    }
    return issues;
  }

  return issues;
};
