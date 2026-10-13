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
  for (let offset = 0; offset < 380; offset += 1) {
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
