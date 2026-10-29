import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const css = fs.readFileSync(path.resolve(__dirname, '../src/styles/mobile-chat-calendar-fix.css'), 'utf8');
describe('reminder mobile floating action', () => {
  it('positions the add button outside document flow with safe-area spacing above the dock', () => {
    const fab = css.slice(css.indexOf('The reminder FAB was only given mobile dimensions'));
    expect(fab).toContain('position: fixed !important');
    expect(fab).toContain('bottom: calc(92px + env(safe-area-inset-bottom)) !important');
    expect(fab).toContain('z-index: 240 !important');
    expect(fab).toContain('inset-inline-end: 16px !important');
    expect(fab).toContain('min-width: 56px !important');
  });
});
