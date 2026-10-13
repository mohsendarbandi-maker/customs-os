import { jalaliMonthLength, jalaliWeekday, zonedJalaliToDate } from '../../lib/jalali';


/**
 * Iranian national holidays transcribed for Solar Hijri year 1405.
 * Source of the annual calendar: University of Tehran, Institute of Geophysics,
 * Calendar Center (official country calendar PDF).
 *
 * The dataset intentionally covers only 1405. Do not infer lunar holidays for
 * other years; add a new year only after its official calendar is published.
 */
export const IRAN_CALENDAR_SOURCE_URL =
  'https://calendar.ut.ac.ir/documents/2139738/7092644/Calendar-1405.pdf';

export const IRAN_CALENDAR_SOURCE_NAME = 'مرکز تقویم مؤسسه ژئوفیزیک دانشگاه تهران';

export const IRAN_CALENDAR_DATA_YEAR = 1405;

export type IranCalendarHoliday = {
  date: string;
  title: string;
};

/** Verified annual national holidays currently bundled offline (Jalali YYYY-MM-DD). */
export const IRAN_OFFICIAL_HOLIDAYS_1405: readonly IranCalendarHoliday[] = [
  { date: '1405-01-01', title: 'نوروز و عید سعید فطر' },
  { date: '1405-01-02', title: 'عید نوروز' },
  { date: '1405-01-03', title: 'عید نوروز' },
  { date: '1405-01-04', title: 'عید نوروز' },
  { date: '1405-01-12', title: 'روز جمهوری اسلامی ایران' },
  { date: '1405-01-13', title: 'روز طبیعت' },
  { date: '1405-01-24', title: 'شهادت امام جعفر صادق' },
  { date: '1405-03-03', title: 'شهادت امام محمد باقر' },
  { date: '1405-03-06', title: 'عید سعید قربان' },
  { date: '1405-03-14', title: 'رحلت امام خمینی و عید سعید غدیر خم' },
  { date: '1405-03-15', title: 'قیام ۱۵ خرداد' },
  { date: '1405-04-03', title: 'تاسوعای حسینی' },
  { date: '1405-04-04', title: 'عاشورای حسینی' },
  { date: '1405-05-13', title: 'اربعین حسینی' },
  { date: '1405-05-21', title: 'رحلت پیامبر اکرم و شهادت امام حسن مجتبی' },
  { date: '1405-05-22', title: 'شهادت امام رضا' },
  { date: '1405-05-30', title: 'شهادت امام حسن عسکری' },
  { date: '1405-06-08', title: 'میلاد پیامبر اکرم و امام جعفر صادق' },
  { date: '1405-08-22', title: 'شهادت حضرت فاطمه زهرا' },
  { date: '1405-10-02', title: 'میلاد امام علی و روز پدر' },
  { date: '1405-10-16', title: 'مبعث پیامبر اکرم' },
  { date: '1405-11-04', title: 'ولادت حضرت قائم و نیمه شعبان' },
  { date: '1405-11-22', title: 'پیروزی انقلاب اسلامی' },
  { date: '1405-12-09', title: 'شهادت امام علی' },
  { date: '1405-12-19', title: 'عید سعید فطر' },
  { date: '1405-12-20', title: 'تعطیل عید سعید فطر' },
  { date: '1405-12-29', title: 'روز ملی شدن صنعت نفت' },
] as const;

const holidayByDate = new Map(
  IRAN_OFFICIAL_HOLIDAYS_1405.map((holiday) => [holiday.date, holiday]),
);

/** Non-holiday cultural and professional observances; these never imply a day off. */
const observanceByDate = new Map<string, string>([
  ['1405-01-01', 'آغاز سال نو؛ نوروز'],
  ['1405-01-13', 'روز طبیعت'],
  ['1405-02-01', 'روز بزرگداشت سعدی'],
  ['1405-02-10', 'روز ملی خلیج فارس'],
  ['1405-02-12', 'روز معلم'],
  ['1405-02-25', 'روز بزرگداشت فردوسی'],
  ['1405-03-03', 'آزادسازی خرمشهر'],
  ['1405-06-01', 'روز پزشک؛ بزرگداشت ابن‌سینا'],
  ['1405-07-20', 'روز بزرگداشت حافظ'],
  ['1405-09-16', 'روز دانشجو'],
  ['1405-10-30', 'شب یلدا'],
  ['1405-12-05', 'روز مهندس؛ بزرگداشت خواجه نصیرالدین طوسی'],
]);

export type IranDayOverride = 'working' | 'holiday';
export type IranCalendarDayInfo = {
  date: string;
  weekday: string;
  isFriday: boolean;
  holiday: IranCalendarHoliday | null;
  observance: string | null;
  isOfficialHoliday: boolean;
  isWorkingDay: boolean | null;
  annualHolidayDataAvailable: boolean;
  override: IranDayOverride | null;
};

export type IranCalendarOverrides = Readonly<Record<string, IranDayOverride | undefined>>;

const pad = (value: number) => String(value).padStart(2, '0');
export const iranJalaliDateKey = (year: number, month: number, day: number) =>
  `${year}-${pad(month)}-${pad(day)}`;

function weekdayForJalaliDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekdayIndex = jalaliWeekday(zonedJalaliToDate(year, month, day, 12, 0, 0));
  return ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'][weekdayIndex];
}

function isValidJalaliDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || year > 3175) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;
  try {
    return day <= jalaliMonthLength(year, month);
  } catch {
    return false;
  }
}

export function hasVerifiedIranHolidayData(year: number): boolean {
  return year === IRAN_CALENDAR_DATA_YEAR;
}

export function getIranCalendarDayInfo(
  year: number,
  month: number,
  day: number,
  overrides: IranCalendarOverrides = {},
): IranCalendarDayInfo {
  const date = iranJalaliDateKey(year, month, day);
  const override = overrides[date] ?? null;
  const holiday = year === IRAN_CALENDAR_DATA_YEAR ? holidayByDate.get(date) ?? null : null;
  const observance = year === IRAN_CALENDAR_DATA_YEAR ? observanceByDate.get(date) ?? null : null;
  const weekday = weekdayForJalaliDate(date);
  const isFriday = weekday === 'Fri';
  const isOfficialHoliday = Boolean(holiday);
  const isWorkingDay = override
    ? override === 'working'
    : !hasVerifiedIranHolidayData(year)
      ? (isFriday ? false : null)
      : !isFriday && !isOfficialHoliday;

  return {
    date,
    weekday,
    isFriday,
    holiday,
    observance,
    isOfficialHoliday,
    isWorkingDay,
    annualHolidayDataAvailable: hasVerifiedIranHolidayData(year),
    override,
  };
}

export function isIranWorkingDay(date: string, overrides: IranCalendarOverrides = {}): boolean | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  if (!isValidJalaliDate(year, month, day)) return false;
  return getIranCalendarDayInfo(year, month, day, overrides).isWorkingDay;
}

function nextJalaliDate(date: string): string | null {
  const [year, month, day] = date.split('-').map(Number);
  if (!isValidJalaliDate(year, month, day)) return null;
  let nextYear = year;
  let nextMonth = month;
  let nextDay = day + 1;
  if (nextDay > jalaliMonthLength(nextYear, nextMonth)) {
    nextDay = 1;
    nextMonth += 1;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
  }
  return iranJalaliDateKey(nextYear, nextMonth, nextDay);
}

/** Returns the first working date strictly after the supplied Jalali date. */
export function nextIranWorkingDay(
  date: string,
  overrides: IranCalendarOverrides = {},
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (!isValidJalaliDate(year, month, day) || !hasVerifiedIranHolidayData(year)) return null;
  let cursor = date;
  for (let offset = 0; offset < 370; offset += 1) {
    const next = nextJalaliDate(cursor);
    if (!next || !hasVerifiedIranHolidayData(Number(next.slice(0, 4)))) return null;
    if (isIranWorkingDay(next, overrides) === true) return next;
    cursor = next;
  }
  return null;
}

/** Adds non-negative Iranian working days, returning null if annual data is missing. */
export function addIranWorkingDays(
  date: string,
  daysToAdd: number,
  overrides: IranCalendarOverrides = {},
): string | null {
  if (!Number.isInteger(daysToAdd) || daysToAdd < 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (!isValidJalaliDate(year, month, day) || !hasVerifiedIranHolidayData(year)) return null;
  if (daysToAdd === 0) return date;

  let cursor = date;
  let counted = 0;
  for (let offset = 0; offset < 370 && counted < daysToAdd; offset += 1) {
    const next = nextJalaliDate(cursor);
    if (!next || !hasVerifiedIranHolidayData(Number(next.slice(0, 4)))) return null;
    if (isIranWorkingDay(next, overrides) === true) counted += 1;
    cursor = next;
  }
  return counted === daysToAdd ? cursor : null;
}
