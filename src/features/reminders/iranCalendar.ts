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
  { date: '1405-01-25', title: 'شهادت امام جعفر صادق' },
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

/** Selected national, cultural and professional observances for the current official year.
 * These entries are occasions, not public holidays unless also listed in IRAN_OFFICIAL_HOLIDAYS_1405.
 * Dates are Jalali and bundled offline so the calendar works without a network request.
 */
export type IranCalendarObservance = {
  date: string;
  title: string;
  category: 'national' | 'professional' | 'culture' | 'international';
};

export const IRAN_OBSERVANCES_1405: readonly IranCalendarObservance[] = [
  { date: '1405-01-20', title: 'روز ملی فناوری هسته‌ای', category: 'national' },
  { date: '1405-01-25', title: 'روز بزرگداشت عطار نیشابوری', category: 'culture' },
  { date: '1405-02-01', title: 'روز بزرگداشت سعدی', category: 'culture' },
  { date: '1405-02-02', title: 'روز زمین پاک', category: 'international' },
  { date: '1405-02-03', title: 'روز بزرگداشت شیخ بهایی و روز معماری', category: 'professional' },
  { date: '1405-02-09', title: 'روز روان‌شناس و مشاور؛ روز شوراها', category: 'professional' },
  { date: '1405-02-10', title: 'روز ملی خلیج فارس', category: 'national' },
  { date: '1405-02-12', title: 'روز معلم', category: 'professional' },
  { date: '1405-02-15', title: 'روز جهانی ماما', category: 'professional' },
  { date: '1405-02-25', title: 'روز بزرگداشت فردوسی', category: 'culture' },
  { date: '1405-02-27', title: 'روز ارتباطات و روابط عمومی', category: 'professional' },
  { date: '1405-02-28', title: 'روز بزرگداشت خیام', category: 'culture' },
  { date: '1405-03-03', title: 'روز آزادسازی خرمشهر؛ روز مقاومت، ایثار و پیروزی', category: 'national' },
  { date: '1405-03-03', title: 'شهادت امام محمد باقر', category: 'culture' },
  { date: '1405-03-16', title: 'روز ملی محیط زیست', category: 'national' },
  { date: '1405-03-20', title: 'روز جهانی صنایع دستی', category: 'professional' },
  { date: '1405-03-27', title: 'روز جهاد کشاورزی', category: 'professional' },
  { date: '1405-04-07', title: 'روز قوه قضائیه', category: 'national' },
  { date: '1405-04-10', title: 'روز صنعت و معدن', category: 'professional' },
  { date: '1405-04-13', title: 'جشن تیرگان', category: 'culture' },
  { date: '1405-04-14', title: 'روز قلم', category: 'culture' },
  { date: '1405-04-22', title: 'روز ملی فناوری اطلاعات', category: 'professional' },
  { date: '1405-04-25', title: 'روز بهزیستی و تأمین اجتماعی', category: 'professional' },
  { date: '1405-05-17', title: 'روز خبرنگار', category: 'professional' },
  { date: '1405-06-01', title: 'روز بزرگداشت ابوعلی سینا و روز پزشک', category: 'professional' },
  { date: '1405-06-05', title: 'روز داروساز', category: 'professional' },
  { date: '1405-06-08', title: 'روز مبارزه با تروریسم؛ روز کارمند', category: 'national' },
  { date: '1405-06-13', title: 'روز تعاون', category: 'professional' },
  { date: '1405-06-21', title: 'روز ملی سینما', category: 'culture' },
  { date: '1405-06-27', title: 'روز شعر و ادب فارسی؛ بزرگداشت شهریار', category: 'culture' },
  { date: '1405-06-31', title: 'آغاز هفته دفاع مقدس', category: 'national' },
  { date: '1405-07-01', title: 'آغاز سال تحصیلی', category: 'national' },
  { date: '1405-07-07', title: 'روز آتش‌نشانی و ایمنی', category: 'professional' },
  { date: '1405-07-13', title: 'روز ملی دامپزشکی', category: 'professional' },
  { date: '1405-07-20', title: 'روز بزرگداشت حافظ', category: 'culture' },
  { date: '1405-07-24', title: 'روز پرستار؛ ولادت حضرت زینب (س)', category: 'professional' },
  { date: '1405-08-13', title: 'روز دانش‌آموز و روز ملی مبارزه با استکبار جهانی', category: 'national' },
  { date: '1405-08-24', title: 'روز کتاب، کتاب‌خوانی و کتابدار', category: 'culture' },
  { date: '1405-09-05', title: 'روز بسیج مستضعفان', category: 'national' },
  { date: '1405-09-07', title: 'روز نیروی دریایی', category: 'national' },
  { date: '1405-09-15', title: 'روز حسابدار', category: 'professional' },
  { date: '1405-09-16', title: 'روز دانشجو', category: 'national' },
  { date: '1405-09-25', title: 'روز پژوهش و فناوری', category: 'professional' },
  { date: '1405-09-30', title: 'شب یلدا؛ جشن زایش خورشید', category: 'culture' },
  { date: '1405-10-05', title: 'روز ایمنی در برابر زلزله و کاهش اثرات بلایای طبیعی', category: 'national' },
  { date: '1405-11-14', title: 'روز فناوری فضایی', category: 'professional' },
  { date: '1405-11-29', title: 'قیام مردم تبریز', category: 'national' },
  { date: '1405-12-05', title: 'روز مهندس؛ بزرگداشت خواجه نصیرالدین طوسی', category: 'professional' },
  { date: '1405-12-07', title: 'روز وکیل مدافع', category: 'professional' },
  { date: '1405-12-15', title: 'روز درختکاری و آغاز هفته منابع طبیعی', category: 'national' },
  { date: '1405-12-22', title: 'روز بزرگداشت شهدا', category: 'national' },
] as const;

const observancesByDate = new Map<string, readonly IranCalendarObservance[]>();
for (const observance of IRAN_OBSERVANCES_1405) {
  const existing = observancesByDate.get(observance.date) ?? [];
  observancesByDate.set(observance.date, [...existing, observance]);
}

const holidayByDate = new Map(
  IRAN_OFFICIAL_HOLIDAYS_1405.map((holiday) => [holiday.date, holiday]),
);

export type IranDayOverride = 'working' | 'holiday';
export type IranCalendarDayInfo = {
  date: string;
  weekday: string;
  isFriday: boolean;
  holiday: IranCalendarHoliday | null;
  isOfficialHoliday: boolean;
  isWorkingDay: boolean | null;
  annualHolidayDataAvailable: boolean;
  override: IranDayOverride | null;
  observances: readonly IranCalendarObservance[];
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
    isOfficialHoliday,
    isWorkingDay,
    annualHolidayDataAvailable: hasVerifiedIranHolidayData(year),
    override,
    observances: year === IRAN_CALENDAR_DATA_YEAR ? (observancesByDate.get(date) ?? []) : [],
  };
}

export type IranCalendarMonthEvent = {
  date: string;
  day: number;
  weekday: string;
  titles: string[];
  isOfficialHoliday: boolean;
  isFriday: boolean;
};

export function getIranCalendarMonthEvents(year: number, month: number): IranCalendarMonthEvent[] {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 1 || year > 3175) return [];
  const days = jalaliMonthLength(year, month);
  const events: IranCalendarMonthEvent[] = [];
  for (let day = 1; day <= days; day += 1) {
    const info = getIranCalendarDayInfo(year, month, day);
    const titles = [...new Set([...(info.holiday ? [info.holiday.title] : []), ...info.observances.map((item) => item.title)])];
    if (titles.length === 0) continue;
    events.push({ date: info.date, day, weekday: info.weekday, titles, isOfficialHoliday: info.isOfficialHoliday, isFriday: info.isFriday });
  }
  return events;
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
