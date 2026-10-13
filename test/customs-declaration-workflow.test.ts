import { describe, expect, it } from 'vitest';
import {
  addJalaliMonths,
  compareJalaliDates,
  getAbandonedGoodsWarnings,
  isJalaliDeadlinePassed,
  parseJalaliDate,
} from '../src/lib/customsDeclarationWorkflow';

describe('customs workflow Jalali dates', () => {
  it('accepts Persian and Arabic digits and normalizes separators', () => {
    expect(parseJalaliDate('۱۴۰۵/۰۷/۲۱')).toEqual({ year: 1405, month: 7, day: 21 });
    expect(parseJalaliDate('١٤٠٥-٠٧-٢١')).toEqual({ year: 1405, month: 7, day: 21 });
    expect(addJalaliMonths('۱۴۰۵.۰۶.۳۱', 1)).toBe('1405/07/30');
  });

  it('rejects impossible Jalali dates instead of silently treating them as valid', () => {
    expect(parseJalaliDate('1405/13/01')).toBeNull();
    expect(parseJalaliDate('1405/07/31')).toBeNull();
    expect(parseJalaliDate('not-a-date')).toBeNull();
    expect(addJalaliMonths('1405/13/01', 1)).toBeNull();
  });

  it('treats the one-month anniversary as due and avoids a false warning before it', () => {
    expect(isJalaliDeadlinePassed('1405/06/31', 1, new Date('2026-10-21T12:00:00Z'))).toBe(false);
    expect(isJalaliDeadlinePassed('1405/06/31', 1, new Date('2026-10-22T12:00:00Z'))).toBe(true);
  });

  it('compares valid Jalali dates and returns null when either date is invalid', () => {
    expect(compareJalaliDates('1405/07/20', '1405/07/21')).toBe(-1);
    expect(compareJalaliDates('1405/07/21', '1405/07/21')).toBe(0);
    expect(compareJalaliDates('1405/07/22', '1405/07/21')).toBe(1);
    expect(compareJalaliDates('1405/07/31', '1405/07/21')).toBeNull();
  });

  it('raises the correct abandoned-goods warnings and clears a warning when its event is recorded', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    expect(getAbandonedGoodsWarnings({
      loadingFormReceivedAt: '1405/06/31',
      warehouseReceiptAt: '1405/04/31',
    }, now)).toEqual({ loadingFormExpired: true, receiptExpired: true, any: true });

    expect(getAbandonedGoodsWarnings({
      loadingFormReceivedAt: '1405/06/31',
      loadingCompletedAt: '1405/07/20',
      warehouseReceiptAt: '1405/04/31',
      loadingStartedAt: '1405/07/15',
    }, now)).toEqual({ loadingFormExpired: false, receiptExpired: false, any: false });
  });
});
