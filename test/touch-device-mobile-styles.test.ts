import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const css = fs.readFileSync(path.resolve(__dirname, '../src/styles/mobile-chat-calendar-fix.css'), 'utf8');
describe('touch-device mobile styling', () => {
  it('does not depend only on CSS viewport width for iOS desktop-mode Safari', () => {
    const dock = css.slice(css.indexOf('/* Premium iOS-like bottom dock'), css.indexOf('/* Separate the reminder create action'));
    const reminders = css.slice(css.indexOf('/* Separate the reminder create action'));
    expect(dock).toContain('@media (max-width: 767px), (pointer: coarse)');
    expect(reminders).toContain('@media (max-width: 767px), (pointer: coarse)');
    expect(dock).toContain('body .app-mobile-viewport-dock > button svg');
    expect(reminders).toContain('.reminders-app-standalone .reminders-hub-actions .reminders-hub-add');
  });
});
