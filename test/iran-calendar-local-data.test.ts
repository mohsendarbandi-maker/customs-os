import { describe, expect, it } from 'vitest';
import {
  getIranCalendarDayInfo,
  hasVerifiedIranHolidayData,
  IRAN_CALENDAR_SOURCE_URL,
  IRAN_OFFICIAL_HOLIDAYS_1405,
} from '../src/features/reminders/iranCalendar';

describe('locally bundled Iranian annual calendar', () => {
  it('contains the 26 official holidays listed for 1405 without runtime service access', () => {
    expect(IRAN_OFFICIAL_HOLIDAYS_1405).toHaveLength(26);
    expect(IRAN_CALENDAR_SOURCE_URL).toContain('calendar.ut.ac.ir');
    expect(hasVerifiedIranHolidayData(1405)).toBe(true);
    expect(hasVerifiedIranHolidayData(1406)).toBe(false);
  });

  it('uses the official 25 Farvardin date for Imam Jafar Sadiq martyrdom', () => {
    expect(getIranCalendarDayInfo(1405, 1, 25).holiday?.title).toContain('امام جعفر صادق');
    expect(getIranCalendarDayInfo(1405, 1, 24).holiday).toBeNull();
  });

  it('does not mark 3 Khordad as an official public holiday in the 1405 dataset', () => {
    expect(getIranCalendarDayInfo(1405, 3, 3).holiday).toBeNull();
    expect(getIranCalendarDayInfo(1405, 3, 3).observance).toContain('امام محمد باقر');
  });

  it('keeps unsupported years explicitly unverified instead of inventing lunar holidays', () => {
    const info = getIranCalendarDayInfo(1406, 1, 1);
    expect(info.annualHolidayDataAvailable).toBe(false);
    expect(info.holiday).toBeNull();
    expect(info.isWorkingDay).toBeNull();
  });
});
