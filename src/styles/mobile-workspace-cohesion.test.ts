import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const responsive = read('src/responsive.css');
const mobileStyles = read('src/styles/mobile-workspace-cohesion.css');
const mobilePolish = read('src/styles/mobile-polish.css');
const remindersCohesion = read('src/styles/chat-reminders-cohesion.css');
const fileManager = read('src/pages/FileManagerPage.tsx');
const shipments = read('src/components/LatestShipmentStatuses.tsx');
const home = read('src/pages/DesktopHomePage.tsx');
const mainStyles = read('src/main.tsx');
const appShell = read('src/components/AppShell.tsx');
const appearanceContext = read('src/context/AppearanceContext.tsx');
const appearanceSettings = read('src/pages/SettingsEnterprisePage.tsx');

describe('mobile visual cohesion regressions', () => {
  it('loads the Ocean Pro visual layer last and redesigns the actual dashboard surfaces', () => {
    expect(mainStyles).toContain("import './styles/ocean-pro-ui.css';");
    expect(mainStyles.indexOf("import './styles/ocean-pro-ui.css';")).toBeGreaterThan(
      mainStyles.indexOf("import './styles/mobile-chat-calendar-fix.css';"),
    );
    const oceanCss = read('src/styles/ocean-pro-ui.css');
    expect(oceanCss).toContain(':root[data-visual-style="ocean"]');
    expect(oceanCss).toContain('.customs-home header');
    expect(oceanCss).toContain('.customs-stat-line');
    expect(oceanCss).toContain('.customs-widget-frame');
    expect(oceanCss).toContain('.shipment-compact-row');
    expect(oceanCss).toContain('.app-mobile-viewport-dock');
    expect(oceanCss).toContain('@media (min-width:768px) and (max-width:1023px)');
  });

  it('keeps the mobile navigation dock attached to the viewport and exposes full visual themes', () => {
    expect(appShell).toContain('createPortal(<nav className="app-mobile-dock app-mobile-viewport-dock"');
    expect(appShell).toContain('document.body');
    expect(mobilePolish).toContain('.app-mobile-viewport-dock {');
    expect(mobilePolish).toContain('position: fixed !important');
    expect(mobilePolish).toContain('html:has(.app-shell input:focus) .app-mobile-viewport-dock');
    expect(appearanceContext).toContain('type VisualStyle=');
    expect(appearanceContext).toContain('document.documentElement.dataset.visualStyle=appearance.visualStyle');
    expect(appearanceSettings).toContain('visual-theme-options');
    for (const theme of ['ocean', 'aurora', 'glass', 'emerald', 'sunset', 'minimal']) {
      expect(mobileStyles).toContain(`data-visual-style="${theme}"`);
      expect(appearanceSettings).toContain(`value:'${theme}'`);
    }
  });

  it('applies the Adaptive preset as a responsive card dashboard on touch and tablet widths', () => {
    const oceanCss = read('src/styles/ocean-pro-ui.css');
    expect(oceanCss).toContain('html[data-layout-preset="adaptive"] .app-shell .customs-widget-grid');
    expect(oceanCss).toContain('@media (max-width: 767px), (pointer: coarse)');
    expect(oceanCss).toContain('@media (min-width:768px) and (max-width:1023px)');
    expect(oceanCss).toContain('html[data-visual-style] .app-mobile-viewport-dock > button svg');
  });

  it('lets reminders inherit the same global site palette and background', () => {
    const start = responsive.indexOf('/* Reminders use the same global appearance tokens');
    const end = responsive.indexOf('@media (orientation: landscape) and (max-height: 520px)', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const paletteBlock = responsive.slice(start, end);
    expect(paletteBlock).toContain('background: transparent !important');
    expect(paletteBlock).not.toMatch(/--(?:primary|bg|surface|border):\s*#/);
    expect(paletteBlock).not.toContain('#087f8c');
    expect(remindersCohesion).toContain('background: transparent !important');
  });

  it('keeps file manager help collapsed instead of occupying the mobile viewport', () => {
    expect(fileManager).toContain('className="file-manager-page');
    expect(fileManager).toContain('<details className="file-manager-archive-help');
    expect(fileManager).toContain('placeholder="جست‌وجوی صاحب کالا، محموله یا سند…"');
    expect(fileManager).not.toContain('پوشه‌بندی خودکار بر اساس صاحب کالا، محموله و گمرک؛ آرشیو فایل اصلی در تلگرام.');
    expect(fileManager).not.toContain('فایل‌های جدید به همین گفتگو می‌روند؛ در تلگرام نام فایل یا برچسب را در همان گفتگو جست‌وجو کنید.');
    expect(mobileStyles).toContain('.file-manager-page-actions');
    expect(mobileStyles).toContain('.file-manager-archive-help');
  });

  it('renders shipment progress as a labeled five-step card on phones, not a clipped 740px row', () => {
    expect(shipments).toContain("shortLabel: 'انبار'");
    expect(shipments).toContain('shipment-premium-step-dot');
    expect(shipments).toContain('shipment-premium-step-label');
    expect(read('src/styles/mobile-app-premium.css')).toContain('grid-template-columns: repeat(5,minmax(0,1fr))');
    expect(read('src/styles/mobile-app-premium.css')).toContain('.shipment-premium-steps');
    expect(read('src/styles/mobile-app-premium.css')).toContain('min-width: 0!important');
  });

  it('removes the duplicate explanation above the shipment status card', () => {
    expect(home).toContain('<LatestShipmentStatuses/>');
    expect(home).not.toContain('مراحل عملیات در یک نگاه؛ از ثبت محموله تا خروج گمرکی');
    expect(home).not.toContain('LIVE OPERATIONS');
    expect(mainStyles).toContain("import './styles/mobile-workspace-cohesion.css';");
  });
});


describe('non-auth mobile UI review fixes', () => {
  it('keeps primary mobile navigation labels readable and wrap-safe', () => {
    expect(mobileStyles).toContain('.app-shell .app-mobile-dock > button');
    expect(mobileStyles).toContain('font-size: 12px !important;');
    expect(mobileStyles).toContain('-webkit-line-clamp: 2;');
  });

  it('prevents dashboard dates, statistics, and shipment stages from being unnecessarily truncated', () => {
    expect(mobileStyles).toContain('.app-shell .customs-home header p');
    expect(mobileStyles).toContain('white-space: normal !important;');
    expect(mobileStyles).toContain('.app-shell .customs-home .customs-stat > span');
    expect(mobileStyles).toContain('.app-shell .shipment-stage-label');
    expect(mobileStyles).toContain('font-size: 10px !important;');
  });

  it('keeps dialog content and horizontal data views usable on touch screens', () => {
    expect(mobileStyles).toContain('100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px');
    expect(mobileStyles).toContain('overscroll-behavior: contain;');
    expect(mobileStyles).toContain('.app-content .future-route-stage .overflow-x-auto');
    expect(mobileStyles).toContain('-webkit-overflow-scrolling: touch;');
  });

  it('scopes the refinements to the application shell and does not style the sign-in view', () => {
    const start = mobileStyles.lastIndexOf('/* Mobile UI review refinements.');
    expect(start).toBeGreaterThanOrEqual(0);
    const refinements = mobileStyles.slice(start);
    expect(refinements).toContain('.app-shell');
    expect(refinements).not.toContain('.future-auth');
    expect(refinements).not.toContain('.login-page');
  });
});


describe('primary-domain mobile viewport and selectable UI presets', () => {
  it('detects phones even when Safari requests a desktop-sized viewport', () => {
    expect(appShell).toContain('window.screen?.width');
    expect(appShell).toContain('Math.min(viewportWidth, deviceWidth) < 768');
    expect(appShell).toContain("isNarrowDevice ? 'is-narrow-device' : ''");
    expect(appShell).toContain('if (getNarrowDevice()) return false;');
  });

  it('persists the selected UI preset per user and applies it to the document root', () => {
    expect(appearanceContext).toContain("type LayoutPreset='adaptive'|'standard'|'cards'|'compact'");
    expect(appearanceContext).toContain('settings.layoutPresetVersion===2');
    expect(appearanceContext).toContain(":'adaptive'");
    expect(appearanceContext).toContain('document.documentElement.dataset.layoutPreset=appearance.layoutPreset');
    expect(appearanceContext).toContain('setLayoutPreset');
    expect(appearanceSettings).toContain("'layoutPreset'");
  });

  it('offers four accessible layout choices in Appearance settings with live preview', () => {
    expect(appearanceSettings).toContain('layout-preset-options');
    expect(appearanceSettings).toContain("title:'استاندارد'");
    expect(appearanceSettings).toContain("title:'کارت‌محور'");
    expect(appearanceSettings).toContain("title:'فشرده'");
    expect(appearanceSettings).toContain('aria-pressed={appearance.layoutPreset===p.value}');
    expect(appearanceSettings).toContain('appearance.setLayoutPreset');
  });

  it('applies narrow-device responsive content rules independently of CSS viewport media queries', () => {
    expect(mobileStyles).toContain('.app-shell.is-narrow-device .app-content');
    expect(mobileStyles).toContain('.app-shell.is-narrow-device .customs-home .customs-widget-grid');
    expect(mobileStyles).toContain('.app-shell.is-narrow-device .app-mobile-dock');
    expect(mobileStyles).toContain('.layout-preset-options');
    expect(mobileStyles).toContain('.app-shell.is-narrow-device .ai-launcher');
    expect(mobileStyles).toContain('var(--app-mobile-tabbar-height, 68px) + 24px');
    expect(mobileStyles).toContain('.app-shell.is-narrow-device .shipment-compact-row');
    expect(mobileStyles).toContain('.app-shell.is-narrow-device .shipment-stages');
    expect(mobileStyles).toContain('.app-shell.is-narrow-device .shipment-stage-label');
  });

  it('provides separate visual treatments for card and compact layout presets', () => {
    expect(mobileStyles).toContain('html[data-layout-preset="cards"]');
    expect(mobileStyles).toContain('html[data-layout-preset="compact"]');
    expect(mobileStyles).toContain('.layout-preset-preview.standard');
    expect(mobileStyles).toContain('.layout-preset-preview.cards');
    expect(mobileStyles).toContain('.layout-preset-preview.compact');
  });
});


describe('compact mobile density regressions', () => {
  it('reduces dashboard statistics, shell navigation and mobile header dimensions', () => {
    expect(mobileStyles).toContain('min-height: calc(56px + env(safe-area-inset-top)) !important;');
    expect(mobileStyles).toContain('.app-shell .app-mobile-dock > button');
    expect(mobileStyles).toContain('min-height: 43px !important;');
    expect(mobileStyles).toContain('.app-shell .customs-home .customs-stat');
    expect(mobileStyles).toContain('height: 66px !important;');
  });

  it('prevents inherited 48px button sizing from expanding every shipment stage row', () => {
    expect(mobileStyles).toContain('.app-shell .shipment-stage-dot');
    expect(mobileStyles).toContain('min-height: 0 !important;');
    expect(mobileStyles).toContain('.app-shell .shipment-stage-number');
    expect(mobileStyles).toContain('width: 24px !important;');
    expect(mobileStyles).toContain('.app-shell .shipment-current-stage');
    expect(mobileStyles).toContain('min-height: 29px !important;');
  });

  it('keeps the AI launcher compact and above the bottom navigation without covering content', () => {
    expect(mobileStyles).toContain('.app-shell .ai-launcher');
    expect(mobileStyles).toContain('width: 44px !important;');
    expect(mobileStyles).toContain('bottom: calc(64px + env(safe-area-inset-bottom)) !important;');
  });
});
