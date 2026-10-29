import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const modes = fs.readFileSync(path.join(root, 'src/styles/mobile-chat-calendar-fix.css'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src/pages/SettingsEnterprisePage.tsx'), 'utf8');
const appearance = fs.readFileSync(path.join(root, 'src/context/AppearanceContext.tsx'), 'utf8');

describe('appearance theme and comfort compatibility', () => {
  it('offers all six complete visual palettes in settings', () => {
    for (const style of ['ocean', 'aurora', 'glass', 'emerald', 'sunset', 'minimal']) {
      expect(settings).toContain(`value:'${style}'`);
      expect(appearance).toContain(`'${style}'`);
    }
  });

  it('lets every palette use the light appearance mode', () => {
    for (const style of ['ocean', 'aurora', 'glass', 'emerald', 'sunset', 'minimal']) {
      expect(modes).toContain(`html[data-theme="light"][data-visual-style="${style}"]`);
    }
    expect(modes).toContain('color-scheme:light');
  });

  it('supports dark Minimal mode instead of keeping the palette bright', () => {
    expect(modes).toContain('html[data-theme="dark"][data-visual-style="minimal"]');
    expect(modes).toContain('--bg:#0b1220; --surface:#141e2e');
  });

  it('keeps soft, warm and reading comfort modes effective after palette tokens load', () => {
    expect(modes).toContain('html[data-comfort="soft"][data-visual-style]');
    expect(modes).toContain('html[data-comfort="warm"][data-visual-style]');
    expect(modes).toContain('html[data-comfort="reading"][data-visual-style]');
  });
});
