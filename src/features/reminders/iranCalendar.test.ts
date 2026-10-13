import { describe, expect, it } from 'vitest';
import {
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
    expect(IRAN_OFFICIAL_HOLIDAYS_1405.length).toBe(19);
    expect(hasVerifiedIranHolidayData(1405)).toBe(true);
    expect(hasVerifiedIranHolidayData(1406)).toBe(false);
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
    expect(isIranWorkingDay('1405-13-01')).toBe(false);
    expect(isIranWorkingDay('invalid')).toBe(false);
  });
});
