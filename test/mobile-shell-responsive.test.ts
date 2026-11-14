import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const shell = read('src/components/AppShell.tsx');
const mobileCss = read('src/styles/mobile-polish.css');
const baseCss = read('src/index.css');
const home = read('src/pages/DesktopHomePage.tsx');
const unifiedCss = read('src/styles/mobile-native-unified-2026.css');
const productionCss = read('src/styles/native-mobile-production.css');

describe('iOS touch-first application shell', () => {
  it.each([320, 360, 375, 390, 414, 430])('keeps the touch shell contract at %i CSS pixels', (width) => {
    expect(width).toBeLessThan(768);
    expect(shell).toContain("window.matchMedia('(min-width: 1024px)')");
    expect(shell).toContain("(pointer: fine)");
    expect(shell).toContain("(navigator.maxTouchPoints || 0) > 0");
    expect(shell).toContain("'ontouchstart' in window");
    expect(shell).toContain("const widthMedia = window.matchMedia('(min-width: 1024px)')");
    expect(shell).toContain("const pointerMedia = window.matchMedia('(pointer: fine)')");
    expect(shell).toContain("getDesktopLayout");
    expect(shell).toContain("window.location.hostname.toLowerCase() === 'mobile.darbandicommercial.ir'");
    expect(shell).toContain('{isDesktop && (');
    expect(shell).toContain('{!isDesktop && createPortal(<nav className="app-mobile-dock app-mobile-viewport-dock native-bottom-tabs"');
    expect(mobileCss).toContain('@media (max-width: 1023px), (pointer: coarse)');
    expect(mobileCss).toContain('.app-sidebar, .app-topbar, .app-scrim, .app-mobile-drawer');
    expect(mobileCss).toContain('Desktop navigation is also removed from the React tree');
  });

  it('mounts exactly five primary tabs and puts secondary modules in the full-screen More page', () => {
    const dockStart = shell.indexOf('className="app-mobile-dock app-mobile-viewport-dock native-bottom-tabs"');
    const dockEnd = shell.indexOf('</nav>, document.body)}', dockStart);
    expect(dockStart).toBeGreaterThanOrEqual(0);
    expect(dockEnd).toBeGreaterThan(dockStart);
    const dock = shell.slice(dockStart, dockEnd);

    for (const label of ['خانه', 'عملیات', 'یادآورها', 'چت', 'بیشتر']) {
      expect(dock).toContain('<span>' + label + '</span>');
    }
    expect(shell).toContain('const isMoreRoute = location.pathname === \'/more\'');
    expect(shell).toContain('native-more-profile');
    expect(shell).toContain('native-more-search');
    expect(shell).toContain('native-more-grid');
    expect(shell).toContain('items.filter(item => item.group === group).map(item => {');
    expect(mobileCss).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(shell).not.toContain('mobile-menu-trigger');
  });

  it('protects content from sidebar, Safari safe-area and tab-bar overlap', () => {
    expect(unifiedCss).toContain('--app-mobile-tabbar-height:var(--cos-tab-height)');
    expect(unifiedCss).toContain('--native-shell-tab-height:var(--cos-tab-height)');
    expect(unifiedCss).toContain('--app-mobile-header-height:var(--cos-header-height)');
    expect(mobileCss).toContain('--app-mobile-tabbar-height: var(--cos-tab-height, 70px)');
    expect(mobileCss).toContain('--app-mobile-header-height: var(--cos-header-height, 62px)');
    expect(mobileCss).toContain('min-height: 100dvh');
    expect(mobileCss).toContain('env(safe-area-inset-top)');
    expect(mobileCss).toContain('env(safe-area-inset-bottom)');
    expect(mobileCss).toContain('padding: 10px 12px calc(var(--app-mobile-tabbar-height) + env(safe-area-inset-bottom) + 18px) !important');
    expect(mobileCss).toContain('bottom: calc(var(--app-mobile-tabbar-height) + env(safe-area-inset-bottom) + 12px) !important');
    expect(mobileCss).toContain('.shipment-status-search { position: relative !important; inset: auto !important; }');
    expect(mobileCss).toContain('html:has(.app-shell input:focus) .app-mobile-viewport-dock');
    expect(mobileCss).toContain('.app-shell:has(.chat-standalone[data-chat-selected="true"]) .chat-standalone');
    expect(baseCss).toContain('*{box-sizing:border-box;min-width:0}');
  });

  it('uses one authoritative token set for header, floating dock and content clearance', () => {
    expect(unifiedCss).toContain('--cos-header-height:62px');
    expect(unifiedCss).toContain('--cos-tab-height:70px');
    expect(unifiedCss).toContain('--cos-tab-inset:10px');
    expect(unifiedCss).toContain('--cos-tab-clearance:10px');
    expect(unifiedCss).toContain('--cos-tab-reserve:calc(var(--cos-tab-height) + var(--cos-tab-inset) + var(--cos-tab-clearance) + env(safe-area-inset-bottom))');
    expect(unifiedCss).toContain('height:var(--cos-tab-height)!important');
    expect(unifiedCss).toContain('padding:12px 12px var(--cos-tab-reserve)!important');
    expect(unifiedCss).toContain(':root { --cos-tab-height:64px; }');
    expect(productionCss).not.toContain('--native-shell-tab-height: 64px');
    expect(productionCss).not.toContain('padding-bottom: calc(64px + env(safe-area-inset-bottom))');
  });

  it('keeps dashboard cards readable and uses Persian date formatting', () => {
    expect(mobileCss).toContain('.customs-home-tagline { display: none !important; }');
    expect(mobileCss).toContain('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;');
    expect(mobileCss).toContain('text-overflow: ellipsis; white-space: nowrap;');
    expect(home).toContain("new Intl.DateTimeFormat('fa-IR-u-ca-persian'");
    expect(home).toContain('opacity-40">،</span>');
  });

  it('restores scroll per route and supports RTL back from nested screens', () => {
    expect(shell).toContain("routeScrollStorageKey(routeKey)");
    expect(shell).toContain('window.scrollTo({ top: savedPosition ?? 0, left: 0, behavior: \'auto\' })');
    expect(shell).toContain("location.pathname.startsWith('/operations') && location.search");
    expect(shell).toContain('const showMobileBack = !isPrimaryMobileRoute');
    expect(shell).toContain('aria-label="بازگشت"');
  });

  it('adds Home Screen-only right-edge swipe back without hijacking editors or module scrollers', () => {
    expect(shell).toContain("!isStandalonePwa()");
    expect(shell).toContain('touch.clientX < window.innerWidth - 26');
    expect(shell).toContain("'input'");
    expect(shell).toContain("'.overflow-x-auto'");
    expect(shell).not.toContain("'.app-more-sheet'");
    expect(shell).toContain("'.chat-standalone'");
    expect(shell).toContain("'.reminders-app-standalone'");
    expect(shell).toContain('event.changedTouches.length !== 1');
    expect(shell).not.toContain('mobileOpen');
    expect(shell).not.toContain('moreSheetRef');
  });});
