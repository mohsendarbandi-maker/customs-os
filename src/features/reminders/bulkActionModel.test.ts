import {describe,expect,it} from 'vitest';
import {summarizeReminderBulkAction} from './bulkActionModel';

describe('localized reminder bulk action summary',()=>{
 it('uses clear Persian action summaries and counts',()=>{
  expect(summarizeReminderBulkAction('snooze',3,1,'fa')).toBe('۳ یادآور به تعویق افتاد؛ ۱ مورد ناموفق بود.');
  expect(summarizeReminderBulkAction('remove',2,0,'fa')).toBe('۲ یادآور از فهرست حذف شد.');
 });
 it('uses correct English singular and plural',()=>{
  expect(summarizeReminderBulkAction('complete',1,0,'en')).toBe('1 reminder completed.');
  expect(summarizeReminderBulkAction('remove',2,1,'en')).toBe('2 reminders removed from the list. 1 item failed.');
 });
 it('does not claim an action succeeded when every request failed',()=>{
  expect(summarizeReminderBulkAction('complete',0,2,'fa')).toBe('عملیات انجام نشد؛ ۲ مورد ناموفق بود.');
  expect(summarizeReminderBulkAction('snooze',0,1,'en')).toBe('No reminders were changed. 1 item failed.');
 });
});
