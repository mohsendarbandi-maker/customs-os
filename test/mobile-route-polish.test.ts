import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const css = read('src/styles/mobile-route-polish-2026.css');
const main = read('src/main.tsx');

describe('mobile route finishing layer', () => {
  it('loads after the previous mobile shell and viewport layers', () => {
    const polishImport = main.indexOf("import './styles/mobile-route-polish-2026.css';");
    const lastLegacyImport = main.indexOf("import './styles/mobile-native-chat-viewport-fix-2026.css';");
    expect(polishImport).toBeGreaterThan(lastLegacyImport);
  });

  it('scopes the new visual layer to touch-first and phone layouts', () => {
    expect(css).toContain('@media (max-width: 1023px), (pointer: coarse)');
    expect(css).toContain('.app-shell.is-touch-layout');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('finishes the major operational modules without changing their data services', () => {
    for (const selector of [
      '.file-manager-page.fm-fullscreen-page',
      '.fm-workspace-layout',
      '.pdf-studio-page',
      '.finance-page',
      '.shipment-reports-page',
      '.registration-orders-page',
      '.customs-document-manager-page',
      '.enterprise-erp-page',
    ]) expect(css).toContain(selector);
  });

  it('keeps inputs usable on iOS and Latin references isolated in RTL pages', () => {
    expect(css).toContain('font-size:16px!important');
    expect(css).toContain('min-height:46px');
    expect(css).toContain('unicode-bidi:isolate');
  });

  it('preserves local horizontal scrolling only for explicit data surfaces', () => {
    expect(css).toContain('[data-horizontal-scroll]');
    expect(css).toContain('overscroll-behavior-inline:contain');
  });
});
