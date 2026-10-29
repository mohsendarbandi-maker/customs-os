import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/features/reminders/RemindersPage.tsx'), 'utf8');
const picker = fs.readFileSync(path.join(root, 'src/features/reminders/JalaliDateTimePicker.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/styles/mobile-chat-calendar-fix.css'), 'utf8');
const holidays = fs.readFileSync(path.join(root, 'src/features/reminders/iranCalendar.ts'), 'utf8');

describe('Reminder calendar Option A', () => {
  it('shows Gregorian day numbers inside every main calendar day cell', () => {
    expect(page).toContain('reminders-calendar-cell-gregorian');
    expect(page).toContain('toGregorian(calendarMonth.year,calendarMonth.month,cell.day).gd');
  });

  it('keeps holiday names out of crowded cells and retains an accessible holiday label', () => {
    expect(page).toContain('cell.iranDay?.holiday?.title');
    expect(page).toContain('reminders-calendar-cell-holiday-dot');
    expect(page).not.toContain("t('تعطیل')}</span>:cell.iranDay?.observance");
  });

  it('removes oversized quick-date shortcuts and displays both calendars in the picker', () => {
    expect(picker).toContain('reminders-calendar-picker-day-gregorian');
    expect(picker).toContain('getIranCalendarDayInfo(year,month,day).holiday');
    expect(picker).not.toContain('امروز عصر');
    expect(picker).not.toContain('فردا صبح');
    expect(picker).not.toContain('آخر هفته');
    expect(picker).not.toContain('Sunrise');
  });

  it('offers time only when explicitly requested', () => {
    expect(picker).toContain('افزودن ساعت');
    expect(picker).toContain('حذف ساعت');
    expect(picker).toContain('allDay?t(\'بدون ساعت\')');
    expect(page).toContain('const [quickDueAt,setQuickDueAt]=useState<Date|null>(null);const [quickAllDay,setQuickAllDay]=useState(true);');
  });

  it('defines fixed seven-column grids and compact day-number typography for narrow screens', () => {
    expect(css).toContain('grid-template-columns: repeat(7, minmax(0, 1fr)) !important');
    expect(css).toContain('.reminders-calendar-cell-gregorian');
    expect(css).toContain('.reminders-calendar-picker-day-gregorian');
    expect(css).toContain('.reminders-calendar-time-toggle');
  });

  it('keeps annual holiday data bundled in source instead of fetching an API at runtime', () => {
    expect(holidays).toContain('IRAN_OFFICIAL_HOLIDAYS_1405');
    expect(holidays).not.toMatch(/\bfetch\s*\(/);
    expect(holidays).not.toMatch(/axios\./);
  });
});
