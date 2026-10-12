import { describe, expect, it } from 'vitest';
import { addJalaliDays, jalaliWeekday, toJalali, zonedJalaliToDate } from '../../lib/jalali';
import {
  buildJalaliMonthGrid,
  jalaliDayKey,
  parseReminderDayKey,
  readJalaliMonth,
  shiftJalaliMonth,
} from './calendarModel';

describe('تقویم ماهانهٔ یادآورها', () => {
  const fixedNow = zonedJalaliToDate(1405, 7, 10, 12, 0);

  it('تمام روزهای ماه را با شروع هفته از شنبه در یک شبکهٔ کامل قرار می‌دهد', () => {
    const grid = buildJalaliMonthGrid(1405, 7, [], fixedNow);
    const days = grid.filter((cell) => cell.day !== null);
    expect(days.map((cell) => cell.day)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    expect(grid.length % 7).toBe(0);
    const expectedLeading = jalaliWeekday(zonedJalaliToDate(1405, 7, 1, 12, 0));
    expect(grid.slice(0, expectedLeading).every((cell) => cell.day === null)).toBe(true);
  });

  it('یادآورها را طبق روز شمسی تهران می‌شمارد و روز امروز را مشخص می‌کند', () => {
    const reminders = [
      { due_at: zonedJalaliToDate(1405, 7, 10, 9, 0).toISOString() },
      { due_at: zonedJalaliToDate(1405, 7, 10, 18, 0).toISOString() },
      { due_at: zonedJalaliToDate(1405, 7, 11, 9, 0).toISOString() },
      { due_at: null },
      { due_at: 'not-a-date' },
      { due_at: zonedJalaliToDate(1405, 8, 1, 9, 0).toISOString() },
    ];
    const grid = buildJalaliMonthGrid(1405, 7, reminders, fixedNow);
    expect(grid.find((cell) => cell.key === '1405-07-10')).toMatchObject({ day: 10, count: 2, isToday: true });
    expect(grid.find((cell) => cell.key === '1405-07-11')).toMatchObject({ day: 11, count: 1, isToday: false });
  });

  it('کلید روز شمسی را به ابتدای همان روز تبدیل می‌کند', () => {
    const date = parseReminderDayKey('1405-07-10');
    expect(date).not.toBeNull();
    expect(toJalali(date!)).toEqual({ year: 1405, month: 7, day: 10 });
    expect(date!.getTime()).toBe(zonedJalaliToDate(1405, 7, 10, 0, 0).getTime());
  });

  it('کلید میلادی قدیمی فاز اول را نیز می‌پذیرد', () => {
    const legacyDate = new Date('2026-10-12T12:00:00+03:30');
    const legacyKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(legacyDate);
    const key = `${legacyKey.find((part) => part.type === 'year')?.value}-${legacyKey.find((part) => part.type === 'month')?.value}-${legacyKey.find((part) => part.type === 'day')?.value}`;
    const parsed = parseReminderDayKey(key);
    expect(parsed).not.toBeNull();
    expect(toJalali(parsed!)).toEqual(toJalali(addJalaliDays(legacyDate, 0)));
  });

  it('ماه نامعتبر را امن به ماه جاری برمی‌گرداند', () => {
    expect(readJalaliMonth('1405-13', fixedNow)).toEqual({ year: 1405, month: 7 });
    expect(readJalaliMonth('oops', fixedNow)).toEqual({ year: 1405, month: 7 });
    expect(readJalaliMonth('1405-08', fixedNow)).toEqual({ year: 1405, month: 8 });
  });

  it('جابجایی ماه از مرز سال جلالی عبور می‌کند', () => {
    expect(shiftJalaliMonth({ year: 1405, month: 12 }, 1)).toEqual({ year: 1406, month: 1 });
    expect(shiftJalaliMonth({ year: 1406, month: 1 }, -1)).toEqual({ year: 1405, month: 12 });
  });

  it('کلید روز شمسی با صفرهای ابتدایی پایدار می‌ماند', () => {
    expect(jalaliDayKey(1405, 7, 3)).toBe('1405-07-03');
  });
});
