import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const shell = read('src/components/AppShell.tsx');
const styles = read('src/styles/mobile-shell-fixes.css');
const entry = read('src/main.tsx');
const dashboard = read('src/pages/DesktopHomePage.tsx');

describe('unified iOS navigation and viewport invariants', () => {
  it('uses one 1024px JS breakpoint and removes desktop navigation from compact view DOM', () => {
    expect(shell).toContain("window.matchMedia('(max-width: 1023px)')");
    expect(shell).toContain('{!isCompactViewport && (');
    expect(shell).toContain('{isCompactViewport && <nav className="app-mobile-dock"');
    expect(shell).not.toContain('className="icon-btn mobile-menu-trigger"');
    expect(shell).not.toContain('/* ── Mobile Drawer ── */');
    expect(styles).toContain('@media (min-width: 1024px)');
    expect(styles).toContain('.app-sidebar { display: flex !important; }');
  });

  it('keeps exactly five primary tabs and places remaining role-visible sections in a 3-column More sheet', () => {
    expect(shell).toContain('aria-label="پیمایش اصلی"');
    expect(shell).toContain('<span>خانه</span>');
    expect(shell).toContain('<span>عملیات</span>');
    expect(shell).toContain('<span>یادآورها</span>');
    expect(shell).toContain('<span>چت</span>');
    expect(shell).toContain('<span>بیشتر</span>');
    expect(shell).toContain('mobile-more-grid');
    expect(shell).toContain('{filteredNav.map((item) => {');
    expect(styles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr)) !important;');
  });

  it('accounts for dynamic viewport and iOS safe areas and reserves content space below the dock', () => {
    expect(styles).toContain('height: 100dvh !important');
    expect(styles).toContain('env(safe-area-inset-top)');
    expect(styles).toContain('env(safe-area-inset-bottom)');
    expect(styles).toContain('padding: 12px 12px calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom) + 12px)');
    expect(styles).toContain('bottom: 0 !important;');
  });

  it('keeps floating AI controls above the dock and hides global tabs in an active chat or while typing', () => {
    expect(styles).toContain('bottom: calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom) + 12px) !important;');
    expect(styles).toContain('.app-shell.is-chat-route:has(.chat-standalone[data-chat-selected="true"]) .app-mobile-dock');
    expect(styles).toContain('body:has(.chat-standalone input:focus, .chat-standalone textarea:focus');
  });

  it('loads the override last and uses Persian punctuation for the dashboard date line', () => {
    expect(entry.indexOf("import './styles/mobile-shell-fixes.css';")).toBeGreaterThan(
      entry.indexOf("import './styles/mobile-polish.css';"),
    );
    expect(dashboard).toContain('<span className="mx-1 opacity-60">،</span>');
    expect(dashboard).not.toContain('<span className="mx-1 opacity-40">/</span>');
  });
});
