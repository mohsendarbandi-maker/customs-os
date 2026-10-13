import {reminderNumber,type ReminderLanguage} from './reminderI18n';

export type ReminderBulkAction = 'complete' | 'snooze' | 'remove';

/** Localized, honest completion summary for a batch action. */
export function summarizeReminderBulkAction(
  action: ReminderBulkAction,
  succeeded: number,
  failed: number,
  language: ReminderLanguage,
): string {
  const successCount = Math.max(0, Math.trunc(succeeded));
  const failedCount = Math.max(0, Math.trunc(failed));
  const isPersian = language === 'fa';

  if (successCount === 0 && failedCount === 0) {
    return isPersian ? 'هیچ موردی تغییر نکرد.' : 'No items were changed.';
  }

  const verbs = isPersian
    ? { complete: 'تکمیل شد', snooze: 'به تعویق افتاد', remove: 'از فهرست حذف شد' }
    : { complete: 'completed', snooze: 'snoozed', remove: 'removed from the list' };

  const parts: string[] = [];
  if (successCount > 0) {
    const noun = isPersian ? 'یادآور' : successCount === 1 ? 'reminder' : 'reminders';
    parts.push(`${reminderNumber(successCount, language)} ${noun} ${verbs[action]}`);
  } else {
    parts.push(isPersian ? 'عملیات انجام نشد' : 'No reminders were changed');
  }

  if (failedCount > 0) {
    const failure = isPersian
      ? `${reminderNumber(failedCount, language)} مورد ناموفق بود`
      : `${reminderNumber(failedCount, language)} item${failedCount === 1 ? '' : 's'} failed`;
    parts.push(failure);
  }

  return parts.join(isPersian ? '؛ ' : '. ') + (isPersian ? '.' : '.');
}
