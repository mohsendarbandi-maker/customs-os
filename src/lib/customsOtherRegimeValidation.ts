import { compareJalaliDates, parseJalaliDate } from './customsDeclarationWorkflow';

export type AdditionalRegimeState = Record<string, Record<string, unknown>>;

const text = (value: unknown): string => String(value ?? '').trim();

const requiredFields: Record<string, { key: string; label: string }[]> = {
  documents: [
    { key: 'goodsDescription', label: 'شرح کالا / موضوع عملیات' },
    { key: 'documentReferences', label: 'مراجع اسناد پیوست' },
  ],
  permits: [{ key: 'permitStatus', label: 'وضعیت مجوز' }],
  declaration: [
    { key: 'declarationReference', label: 'شماره کوتاژ / شناسه ثبت' },
    { key: 'declarationDate', label: 'تاریخ ثبت' },
  ],
  loading: [{ key: 'location', label: 'محل فعلی کالا / انبار / منطقه' }],
  exit: [{ key: 'dispositionStatus', label: 'وضعیت نهایی / تعیین تکلیف' }],
  completed: [{ key: 'closureReference', label: 'مرجع تأیید نهایی' }],
};

const dateFields = [
  { stage: 'declaration', key: 'declarationDate', label: 'تاریخ ثبت' },
  { stage: 'loading', key: 'movementDate', label: 'تاریخ جابه‌جایی' },
  { stage: 'exit', key: 'dispositionDate', label: 'تاریخ واقعی تعیین تکلیف' },
] as const;

export const validateAdditionalRegimeStage = (
  stage: string,
  state: AdditionalRegimeState,
): string[] => {
  const issues = (requiredFields[stage] || [])
    .filter(field => !text(state[stage]?.[field.key]))
    .map(field => '«' + field.label + '» را تکمیل کنید.');

  for (const field of dateFields) {
    if (stage !== field.stage) continue;
    const value = text(state[field.stage]?.[field.key]);
    if (value && !parseJalaliDate(value)) {
      issues.push('«' + field.label + '» باید تاریخ شمسی معتبر به‌شکل سال/ماه/روز باشد.');
    }
  }

  if (stage === 'exit' || stage === 'completed') {
    const declarationDate = text(state.declaration?.declarationDate);
    const movementDate = text(state.loading?.movementDate);
    const dispositionDate = text(state.exit?.dispositionDate);
    const dateOrder = [
      { left: declarationDate, right: movementDate, message: 'تاریخ جابه‌جایی نمی‌تواند قبل از تاریخ ثبت اظهار باشد.' },
      { left: movementDate || declarationDate, right: dispositionDate, message: 'تاریخ تعیین تکلیف نمی‌تواند قبل از تاریخ جابه‌جایی یا ثبت اظهار باشد.' },
    ];
    for (const item of dateOrder) {
      if (item.left && item.right && compareJalaliDates(item.left, item.right) === 1) {
        issues.push(item.message);
      }
    }
  }

  return [...new Set(issues)];
};
