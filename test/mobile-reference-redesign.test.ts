import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const referenceCss = read('src/styles/mobile-reference-redesign.css');
const main = read('src/main.tsx');
const shell = read('src/components/AppShell.tsx');
const detail = read('src/pages/CaseStagePage.tsx');

describe('reference-led ocean mobile redesign', () => {
  it('loads the reference layer after the native mobile foundation', () => {
    expect(main).toContain("import './styles/mobile-reference-redesign.css';");
    expect(main.indexOf("import './styles/mobile-reference-redesign.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/mobile-native-workspace.css';"));
  });

  it('uses the reference navigation order: more, chat, operations, reminders, home', () => {
    const dock = shell.slice(shell.indexOf('aria-label="پیمایش سریع"'));
    const labels = ['بیشتر', 'چت', 'عملیات', 'یادآورها', 'خانه'];
    let previous = -1;
    for (const label of labels) {
      const index = dock.indexOf('<span>' + label + '</span>');
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(shell).toContain('data-route={location.pathname}');
  });

  it('defines the ocean hero, light cards, safe-area dock and reference page treatments', () => {
    expect(referenceCss).toContain('.customs-home::before');
    expect(referenceCss).toContain('var(--mobile-paper)');
    expect(referenceCss).toContain('.app-mobile-viewport-dock');
    expect(referenceCss).toContain('.reminders-app-standalone');
    expect(referenceCss).toContain('.chat-standalone');
    expect(referenceCss).toContain('.visual-theme-options');
    expect(referenceCss).toContain('.shipment-detail-page');
  });

  it('marks the case detail view for its dedicated mobile card layout', () => {
    expect(detail).toContain('className="shipment-detail-page');
  });
});
