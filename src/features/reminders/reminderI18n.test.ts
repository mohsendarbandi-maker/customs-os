import {describe,expect,it} from 'vitest';
import {formatReminderDate,formatReminderDateTime,reminderNumber,reminderText} from './reminderI18n';

describe('reminder bilingual presentation',()=>{
 it('translates core actions and removes literal newline escape artifacts',()=>{
  expect(reminderText('یادآورها','en')).toBe('Reminders');
  expect(reminderText('ثبت یادآور','en')).toBe('Create reminder');
  expect(reminderText('یادآور جدید\\n\\nسررسید اختیاری','fa')).toBe('یادآور جدید سررسید اختیاری');
  expect(reminderText('یادآور جدید\\n\\nسررسید اختیاری','en')).toBe('New reminder No due date');
 });
 it('formats the same instant using the Jalali calendar in the Tehran timezone',()=>{
  const date=new Date('2026-03-21T08:30:00.000Z');
  expect(formatReminderDate(date,'fa')).toContain('۱۴۰۵');
  expect(formatReminderDate(date,'en')).toContain('1405');
  expect(formatReminderDateTime(date,'en')).toContain('·');
  expect(reminderNumber(1234,'fa')).toBe('۱٬۲۳۴');
  expect(reminderNumber(1234,'en')).toBe('1,234');
 });
});
