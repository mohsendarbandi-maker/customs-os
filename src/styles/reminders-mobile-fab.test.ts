import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const css = fs.readFileSync(path.resolve(__dirname, 'reminders-redesign.css'), 'utf8');
describe('mobile reminder add action', () => {
  it('floats the add button independently above the bottom dock with a generous tap target', () => {
    const mobileRule = css.slice(css.lastIndexOf('/* Mobile reminder action:'));
    expect(mobileRule).toContain('position: fixed !important');
    expect(mobileRule).toContain('bottom: calc(94px + env(safe-area-inset-bottom)) !important');
    expect(mobileRule).toContain('width: 56px !important');
    expect(mobileRule).toContain('height: 56px !important');
    expect(mobileRule).toContain('box-shadow: 0 10px 28px');
    expect(mobileRule).toContain('touch-action: manipulation');
  });
});
