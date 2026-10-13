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
  { date: '1405-03-06', title: 'عید سعید قربان' },
  { date: '1405-03-14', title: 'رحلت امام خمینی و عید سعید غدیر خم' },
  { date: '1405-03-15', title: 'قیام ۱۵ خرداد' },
  { date: '1405-05-13', title: 'اربعین حسینی' },
  { date: '1405-05-21', title: 'رحلت پیامبر اکرم و شهادت امام حسن مجتبی' },
  { date: '1405-05-22', title: 'شهادت امام رضا' },
  { date: '1405-05-30', title: 'شهادت امام حسن عسکری' },
  { date: '1405-06-08', title: 'میلاد پیامبر اکرم و امام جعفر صادق' },
  { date: '1405-08-22', title: 'شهادت حضرت فاطمه زهرا' },
  { date: '1405-10-02', title: 'میلاد امام علی و روز پدر' },
  { date: '1405-10-16', title: 'مبعث پیامبر اکرم' },
  { date: '1405-11-22', title: 'پیروزی انقلاب اسلامی' },
  { date: '1405-12-29', title: 'روز ملی شدن صنعت نفت' },
] as const;

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
  isWorkingDay: boolean;
  annualHolidayDataAvailable: boolean;
  override: IranDayOverride | null;
};

export type IranCalendarOverrides = Readonly<Record<string, IranDayOverride | undefined>>;

const pad = (value: number) => String(value).padStart(2, '0');
export const iranJalaliDateKey = (year: number, month: number, day: number) =>
  `${year}-${pad(month)}-${pad(day)}`;

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran',
  weekday: 'short',
});

function weekdayForJalaliDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  // Jalali 1405 starts on 2026-03-21; use a UTC-noon Gregorian date for stable
  // weekday calculation, with no dependency on the visitor's local timezone.
  const gregorian = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  void gregorian;
  const starts = new Date(Date.UTC(2026, 2, 21, 12));
  const daysBefore = [0, 31, 62, 93, 124, 155, 186, 216, 246, 276, 306, 336];
  const offset = daysBefore[month - 1] + day - 1;
  const dateUtc = new Date(starts.getTime() + offset * 86400000);
  // Only 1405 holiday labels are bundled. For other years, Friday calculation
  // is still derived by the Intl Persian calendar formatter below.
  if (year === 1405) return weekdayFormatter.format(dateUtc);
  const jalali = new Date(Date.UTC(2000 + (year % 100), month - 1, day, 12));
  return weekdayFormatter.format(jalali);
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
  const isFriday = weekdayForJalaliDate(date) === 'Fri';
  const isOfficialHoliday = Boolean(holiday);
  const isWorkingDay = override
    ? override === 'working'
    : !isFriday && !isOfficialHoliday;

  return {
    date,
    weekday: weekdayForJalaliDate(date),
    isFriday,
    holiday,
    isOfficialHoliday,
    isWorkingDay,
    annualHolidayDataAvailable: hasVerifiedIranHolidayData(year),
    override,
  };
}

export function isIranWorkingDay(date: string, overrides: IranCalendarOverrides = {}): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const info = getIranCalendarDayInfo(year, month, day, overrides);
  return info.date === date && info.isWorkingDay;
}

/** Returns the first working date strictly after the supplied Jalali date. */
export function nextIranWorkingDay(
  date: string,
  overrides: IranCalendarOverrides = {},
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let cursor = new Date(Date.UTC(2026, 2, 21, 12));
  if (year === 1405) {
    const monthOffsets = [0, 31, 62, 93, 124, 155, 186, 216, 246, 276, 306, 336];
    cursor = new Date(cursor.getTime() + (monthOffsets[month - 1] + day) * 86400000);
    for (let i = 0; i < 370; i += 1) {
      const d = new Date(cursor.getTime() + i * 86400000);
      const offset = Math.floor((d.getTime() - Date.UTC(2026, 2, 21, 12)) / 86400000);
      let remaining = offset;
      let outYear = 1405;
      let outMonth = 1;
      const lengths = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
      while (remaining >= lengths[outMonth - 1] && outMonth <= 12) {
        remaining -= lengths[outMonth - 1];
        outMonth += 1;
      }
      if (outMonth > 12) {
        outYear += 1;
        outMonth = 1;
        remaining = 0;
      }
      const key = iranJalaliDateKey(outYear, outMonth, remaining + 1);
      if (isIranWorkingDay(key, overrides)) return key;
    }
    return null;
  }
  // For years without bundled holiday data, do not claim a next working date:
  // official lunar holidays may be missing.
  return null;
}
