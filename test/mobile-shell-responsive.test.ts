import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const shell = read('src/components/AppShell.tsx');
const mobileCss = read('src/styles/mobile-polish.css');
const baseCss = read('src/index.css');
const home = read('src/pages/DesktopHomePage.tsx');

describe('iOS touch-first application shell', () => {
  it.each([375, 390, 430])('keeps the touch shell contract at %i CSS pixels', (width) => {
    // These representative iPhone CSS widths all belong to the mobile shell.
    expect(width).toBeLessThan(768);
    expect(shell).toContain("window.matchMedia('(min-width: 1024px) and (pointer: fine)')");
    expect(shell).toContain("const media = window.matchMedia('(min-width: 1024px) and (pointer: fine)')");
    expect(shell).toContain('{isDesktop && (');
    expect(shell).toContain('{!isDesktop && <nav className="app-mobile-dock"');
    expect(mobileCss).toContain('@media (max-width: 1023px), (pointer: coarse)');
    expect(mobileCss).toContain('.app-sidebar, .app-topbar, .app-scrim, .app-mobile-drawer');
    expect(mobileCss).toContain('Desktop navigation is also removed from the React tree');
  });

  it('mounts exactly one primary navigation and places all secondary routes in More', () => {
    const dockStart = shell.indexOf('className="app-mobile-dock"');
    const dockEnd = shell.indexOf('</nav>}', dockStart);
    expect(dockStart).toBeGreaterThanOrEqual(0);
    expect(dockEnd).toBeGreaterThan(dockStart);
    const dock = shell.slice(dockStart, dockEnd);

    for (const label of ['خانه', 'عملیات', 'یادآورها', 'چت', 'بیشتر']) {
      expect(dock).toContain('<span>' + label + '</span>');
    }
    expect(shell).toContain('{mobileOpen && !isDesktop && (');
    expect(shell).toContain('<nav className="app-more-grid" aria-label="همه بخش‌ها">');
    expect(shell).toContain('{filteredNav.map((item) => {');
    expect(mobileCss).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(shell).not.toContain('mobile-menu-trigger');
  });

  it('protects content from sidebar, Safari safe-area and tab-bar overlap', () => {
    expect(mobileCss).toContain('--app-mobile-tabbar-height: 70px');
    expect(mobileCss).toContain('--app-mobile-header-height: 56px');
    expect(mobileCss).toContain('min-height: 100dvh');
    expect(mobileCss).toContain('env(safe-area-inset-top)');
    expect(mobileCss).toContain('env(safe-area-inset-bottom)');
    expect(mobileCss).toContain('padding: 10px 12px calc(var(--app-mobile-tabbar-height) + env(safe-area-inset-bottom) + 18px) !important');
    expect(mobileCss).toContain('bottom: calc(var(--app-mobile-tabbar-height) + env(safe-area-inset-bottom) + 12px) !important');
    expect(mobileCss).toContain('.shipment-status-search { position: relative !important; inset: auto !important; }');
    expect(mobileCss).toContain('.app-shell:has(input:focus) .app-mobile-dock');
    expect(mobileCss).toContain('.app-shell:has(.chat-standalone[data-chat-selected="true"]) .app-mobile-dock');
    expect(baseCss).toContain('*{box-sizing:border-box;min-width:0}');
  });

  it('keeps dashboard cards readable and uses Persian date formatting', () => {
    expect(mobileCss).toContain('.customs-home-tagline { display: none !important; }');
    expect(mobileCss).toContain('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;');
    expect(mobileCss).toContain('text-overflow: ellipsis; white-space: nowrap;');
    expect(home).toContain("new Intl.DateTimeFormat('fa-IR-u-ca-persian'");
    expect(home).toContain('opacity-40">،</span>');
  });
});
