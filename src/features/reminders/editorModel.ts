export type ReminderRecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

const RULES: Record<ReminderRecurrenceFrequency, string | null> = {
  none: null,
  daily: 'RRULE:FREQ=DAILY',
  weekly: 'RRULE:FREQ=WEEKLY',
  monthly: 'RRULE:FREQ=MONTHLY;X-JALALI=1',
  yearly: 'RRULE:FREQ=YEARLY;X-JALALI=1',
};

export function recurrenceFrequency(rule: string | null | undefined): ReminderRecurrenceFrequency {
  if (!rule) return 'none';
  const match = rule.toUpperCase().match(/(?:^|[;:])FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/);
  return match ? (match[1].toLowerCase() as Exclude<ReminderRecurrenceFrequency, 'none'>) : 'none';
}

export function recurrenceRuleFor(frequency: ReminderRecurrenceFrequency): string | null {
  return RULES[frequency];
}

export function parseReminderTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw.replace(/[,،;؛]+/g, ' ').split(/\s+/)) {
    const tag = value.trim().replace(/^#+/, '');
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

export function validateReminderTitle(title: string): string | null {
  return title.trim() ? null : 'عنوان یادآور را وارد کنید.';
}
