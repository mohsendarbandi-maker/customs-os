import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Customs OS production native mobile shell', () => {
  const main = read('src/main.tsx');
  const shell = read('src/components/AppShell.tsx');
  const css = read('src/styles/native-mobile-production.css');
  const reminders = read('src/features/reminders/RemindersPage.tsx');
  const chat = read('src/features/chat/ChatPage.tsx');

  it('loads the production hardening layer after every legacy mobile layer', () => {
    expect(main.indexOf("import './styles/native-mobile-production.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/native-app-shell.css';"));
    expect(main.indexOf("import './styles/native-mobile-production.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/mobile-reference-final.css';"));
  });

  it('keeps the native shell at a fixed device height and scrolls only its content viewport', () => {
    expect(css).toContain('height: 100dvh !important');
    expect(css).toContain('.app-shell.is-touch-layout .app-content');
    expect(css).toContain('overflow-y: auto !important');
    expect(css).toContain('overscroll-behavior-y: contain !important');
    expect(css).toContain('.app-mobile-dock.native-bottom-tabs');
    expect(css).toContain('grid-template-columns: repeat(5,minmax(0,1fr)) !important');
  });

  it('overrides the legacy full-document reminders exception without changing reminder data logic', () => {
    expect(reminders).toContain('className="reminders-page reminders-app-standalone');
    expect(css).toContain('html:has(.reminders-app-standalone)');
    expect(css).toContain('height: 100dvh !important');
    expect(css).toContain('.app-shell:has(.reminders-app-standalone) .app-content');
    expect(css).toContain('overflow-y: auto !important');
    expect(css).toContain('.app-shell:has(.reminders-app-standalone) .reminders-page.reminders-app-standalone');
  });

  it('keeps the shared header and five tabs visible when a chat conversation is open', () => {
    expect(chat).toContain('className={chatRootClass}');
    expect(shell).toContain('app-mobilebar native-app-header');
    expect(css).toContain('.app-shell.is-chat-route .app-mobilebar.native-app-header');
    expect(css).toContain('.app-shell.is-chat-route .app-mobile-dock.native-bottom-tabs');
    expect(css).toContain('visibility: visible !important');
    expect(css).toContain('.app-shell.is-chat-route .chat-composer');
    expect(css).toContain('--chat-visible-height');
    expect(css).toContain('--chat-visible-top');
  });

  it('uses the composer above the global dock and avoids a second safe-area spacer', () => {
    expect(css).toContain('padding-bottom: 8px !important');
    expect(css).not.toContain('padding-bottom: max(8px, env(safe-area-inset-bottom)) !important');
    expect(css).toContain('padding: 0 0 calc(var(--native-shell-tab-height) + env(safe-area-inset-bottom))');
  });

  it('animates both exits and entries while preserving interactive route navigation', () => {
    expect(shell).toContain('captureNativeRouteExit');
    expect(shell).toContain('onClickCapture={handleNativeRouteLink}');
    expect(shell).toContain("snapshot.className = 'native-route-exit-snapshot'");
    expect(css).toContain('@keyframes nativeProductionEnter');
    expect(css).toContain('@keyframes nativeProductionExit');
    expect(css).toContain('.native-route-exit-snapshot');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('uses exactly the five required tab labels in the shared shell', () => {
    const start = shell.indexOf('aria-label="پیمایش اصلی برنامه"');
    const end = shell.indexOf('</nav>, document.body)', start);
    const dock = shell.slice(start, end);
    const labels = ['خانه', 'یادآورها', 'عملیات', 'چت', 'بیشتر'];
    const indexes = labels.map(label => dock.indexOf('<span>' + label + '</span>'));
    expect(indexes.every(index => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect((dock.match(/<button type="button"/g) || []).length).toBe(5);
  });
});
