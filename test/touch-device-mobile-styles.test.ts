import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const css = fs.readFileSync(path.resolve(__dirname, '../src/styles/mobile-chat-calendar-fix.css'), 'utf8');
const canonical = fs.readFileSync(path.resolve(__dirname, '../src/styles/mobile-bottom-anchored-shell-2026.css'), 'utf8');
describe('touch-device mobile styling', () => {
  it('uses one responsive dock for touch devices and iOS desktop-mode Safari', () => {
    expect(css).not.toContain('.app-mobile-dock');
    expect(canonical).toContain('@media (max-width: 1023px), (pointer: coarse)');
    expect(canonical).toContain('.app-mobile-dock.native-bottom-tabs');
    expect(canonical).toContain('position: fixed;');
    expect(canonical).toContain('env(safe-area-inset-bottom, 0px)');
    expect(canonical).toContain('min-height: 44px;');
  });
});
