import { describe, expect, it } from 'vitest';
import {
  addIranWorkingDays,
  getIranCalendarDayInfo,
  hasVerifiedIranHolidayData,
  IRAN_CALENDAR_DATA_YEAR,
  IRAN_OFFICIAL_HOLIDAYS_1405,
  isIranWorkingDay,
  nextIranWorkingDay,
} from './iranCalendar';

describe('Iranian Jalali calendar and working days', () => {
  it('bundles holiday data only for a year with a published official source', () => {
    expect(IRAN_CALENDAR_DATA_YEAR).toBe(1405);
    expect(IRAN_OFFICIAL_HOLIDAYS_1405.length).toBe(26);
    expect(hasVerifiedIranHolidayData(1405)).toBe(true);
    expect(hasVerifiedIranHolidayData(1406)).toBe(false);
  });

  it('shows national and professional observances without treating every observance as a public holiday', () => {
    const doctorDay = getIranCalendarDayInfo(1405, 6, 1);
    const engineerDay = getIranCalendarDayInfo(1405, 12, 5);
    expect(doctorDay.observances.some((item) => item.title.includes('روز پزشک'))).toBe(true);
    expect(doctorDay.isOfficialHoliday).toBe(false);
    expect(engineerDay.observances.some((item) => item.title.includes('روز مهندس'))).toBe(true);
    expect(getIranCalendarDayInfo(1405, 1, 25).holiday?.title).toContain('شهادت امام جعفر صادق');
    expect(getIranCalendarDayInfo(1405, 1, 24).isOfficialHoliday).toBe(false);
  });

  it('returns month events with the correct weekday and public-holiday flag', async () => {
    const { getIranCalendarMonthEvents } = await import('./iranCalendar');
    const february = getIranCalendarMonthEvents(1405, 12);
    expect(february.some((event) => event.date === '1405-12-05' && event.titles.some((title) => title.includes('روز مهندس')))).toBe(true);
    expect(february.every((event) => event.weekday.length > 0)).toBe(true);
    expect(getIranCalendarMonthEvents(1406, 12)).toEqual([]);
  });

  it('recognizes Friday as the weekly non-working day without treating Thursday as a weekend', () => {
    expect(getIranCalendarDayInfo(1405, 1, 7).isFriday).toBe(true);
    expect(isIranWorkingDay('1405-01-07')).toBe(false);
    expect(isIranWorkingDay('1405-01-06')).toBe(true);
  });

  it('recognizes bundled official holidays and their labels', () => {
    const day = getIranCalendarDayInfo(1405, 1, 1);
    expect(day.isOfficialHoliday).toBe(true);
    expect(day.isWorkingDay).toBe(false);
    expect(day.holiday?.title).toContain('نوروز');
  });

  it('lets an explicit workday exception override a Friday or holiday', () => {
    expect(isIranWorkingDay('1405-01-01', { '1405-01-01': 'working' })).toBe(true);
    expect(isIranWorkingDay('1405-01-07', { '1405-01-07': 'working' })).toBe(true);
    expect(isIranWorkingDay('1405-01-06', { '1405-01-06': 'holiday' })).toBe(false);
  });

  it('returns the next working day within the bundled year and refuses unsupported years', () => {
    expect(nextIranWorkingDay('1405-01-01')).toBe('1405-01-05');
    expect(nextIranWorkingDay('1406-01-01')).toBeNull();
    expect(addIranWorkingDays('1405-01-01', 1)).toBe('1405-01-05');
    expect(addIranWorkingDays('1405-01-01', 2)).toBe('1405-01-06');
    expect(addIranWorkingDays('1406-01-01', 1)).toBeNull();
    expect(isIranWorkingDay('1405-13-01')).toBe(false);
    expect(isIranWorkingDay('1406-01-01')).toBeNull();
    expect(isIranWorkingDay('invalid')).toBe(false);
  });
});
