import { describe, expect, it } from 'vitest';
import { parseReminderTags, recurrenceFrequency, recurrenceRuleFor, validateReminderTitle } from './editorModel';

describe('reminder editor model', () => {
  it('identifies recurring reminder frequencies, including extended rules', () => {
    expect(recurrenceFrequency('RRULE:FREQ=DAILY')).toBe('daily');
    expect(recurrenceFrequency('RRULE:FREQ=WEEKLY;BYDAY=MO,WE')).toBe('weekly');
    expect(recurrenceFrequency('RRULE:FREQ=MONTHLY;X-JALALI=1')).toBe('monthly');
    expect(recurrenceFrequency('rrule:freq=yearly;X-JALALI=1')).toBe('yearly');
    expect(recurrenceFrequency(null)).toBe('none');
    expect(recurrenceFrequency('invalid')).toBe('none');
  });

  it('maps each selection back to the canonical recurrence rule and can clear it', () => {
    expect(recurrenceRuleFor('daily')).toBe('RRULE:FREQ=DAILY');
    expect(recurrenceRuleFor('weekly')).toBe('RRULE:FREQ=WEEKLY');
    expect(recurrenceRuleFor('monthly')).toBe('RRULE:FREQ=MONTHLY;X-JALALI=1');
    expect(recurrenceRuleFor('yearly')).toBe('RRULE:FREQ=YEARLY;X-JALALI=1');
    expect(recurrenceRuleFor('none')).toBeNull();
  });

  it('normalizes comma-separated and #prefixed tags while preserving first spelling', () => {
    expect(parseReminderTags('  #اسناد, مالی مالی؛#فاکتور  Customs  customs ')).toEqual(['اسناد', 'مالی', 'فاکتور', 'Customs']);
  });

  it('rejects blank titles without rejecting meaningful Persian or English text', () => {
    expect(validateReminderTitle('   ')).toBe('عنوان یادآور را وارد کنید.');
    expect(validateReminderTitle('  پرداخت عوارض  ')).toBeNull();
    expect(validateReminderTitle('Submit declaration')).toBeNull();
  });
});
