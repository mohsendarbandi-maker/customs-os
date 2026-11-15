import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath: string) => fs.readFileSync(path.resolve(testDir, relativePath), 'utf8');

describe('mobile full-height shell and bottom navigation geometry', () => {
  const entry = read('../src/main.tsx');
  const layout = read('../src/styles/mobile-bottom-anchored-shell-2026.css');
  const buildWorkflow = read('../.github/workflows/build.yml');

  it('loads the authoritative dock geometry after all legacy mobile styles', () => {
    expect(entry).toContain("import './styles/mobile-route-polish-2026.css';");
    expect(entry).toContain("import './styles/mobile-bottom-anchored-shell-2026.css';");
    expect(entry.indexOf("import './styles/mobile-bottom-anchored-shell-2026.css';"))
      .toBeGreaterThan(entry.indexOf("import './styles/mobile-route-polish-2026.css';"));
  });

  it('keeps navigation styling and sizing in one canonical stylesheet', () => {
    const legacyStyles = [
      '../src/responsive.css',
      '../src/styles/mobile-polish.css',
      '../src/styles/mobile-native-workspace.css',
      '../src/styles/mobile-chat-calendar-fix.css',
      '../src/styles/mobile-native-chat-viewport-fix-2026.css',
      '../src/styles/mobile-native-interactions-2026.css',
      '../src/styles/mobile-native-unified-2026.css',
      '../src/styles/native-app-shell.css',
      '../src/styles/native-mobile-production.css',
      '../src/styles/mobile-app-premium.css',
      '../src/styles/mobile-reference-redesign.css',
      '../src/styles/mobile-reference-final.css',
      '../src/styles/mobile-workspace-cohesion.css',
      '../src/styles/ocean-pro-ui.css',
    ];
    for (const file of legacyStyles) {
      const css = read(file);
      expect(css, file).not.toMatch(/\.app-mobile-dock\b|\.app-mobile-viewport-dock\b|\.native-bottom-tabs\b/);
    }
    expect(layout.split('--cos-tab-height:').length - 1).toBe(1);
    expect(layout.split('--cos-tab-safe-area:').length - 1).toBe(1);
    expect(layout).not.toContain('--mobile-tabbar-height:');
  });

  it('extends the clipped iOS document viewport through the bottom safe area', () => {
    const nativeProduction = read('../src/styles/native-mobile-production.css');
    expect(layout).toContain('html,\n  body,\n  #root {');
    expect(layout).toContain('height: calc(100dvh + var(--cos-tab-safe-area)) !important;');
    expect(layout).toContain('min-height: calc(100dvh + var(--cos-tab-safe-area)) !important;');
    expect(layout).toContain('max-height: calc(100dvh + var(--cos-tab-safe-area)) !important;');
    expect(nativeProduction).not.toContain('height: 100dvh !important;');
    expect(nativeProduction).not.toContain('max-height: 100dvh !important;');
  });

  it('pins the five-tab dock flush to both side edges and the bottom edge', () => {
    expect(layout).toContain('left: 0;');
    expect(layout).toContain('right: 0;');
    expect(layout).toContain('bottom: 0;');
    expect(layout).toContain('width: 100%;');
    expect(layout).toContain('max-width: none;');
    expect(layout).toContain('.app-mobile-dock.native-bottom-tabs');
    expect(layout).toContain('height: var(--cos-tab-reserve);');
    expect(layout).not.toContain('border-top: 1px solid');
    expect(layout).toContain('inset 0 1px 0 rgba(255, 255, 255, .12)');
  });

  it('keeps the iPhone bottom safe area navy so the dock visually reaches the rounded device edge', () => {
    expect(layout).toContain('.app-shell.is-touch-layout');
    expect(layout).toContain('background: rgba(7, 29, 51, .97);');
    expect(layout).toContain('padding: 0 6px var(--cos-tab-safe-area);');
    expect(layout).toContain('border-radius: 18px 18px 0 0;');
    expect(layout).toContain('padding: 0 6px var(--cos-tab-safe-area);');
    expect(layout).toContain('height: var(--cos-tab-height);');
    expect(layout).toContain('align-items: stretch;');
    expect(layout).toContain('bottom: 0;');
  });

  it('reserves exactly the visible dock height in the scrollable page area', () => {
    expect(layout).toContain('--cos-tab-reserve: calc(var(--cos-tab-height) + var(--cos-tab-safe-area));');
    expect(layout).toContain('padding-bottom: var(--cos-tab-reserve) !important;');
    expect(layout).toContain('.app-shell.is-touch-layout:has(.reminders-app-standalone) .app-content');
    expect(layout).toContain('overflow-y: auto;');
    expect(layout).toContain('scroll-padding-block-end: var(--cos-tab-reserve) !important;');
  });

  it('keeps the dock flush above the keyboard without a stale floating inset', () => {
    expect(layout).toContain('bottom: var(--mobile-keyboard-bottom-inset, 0px);');
    expect(layout).not.toContain('--chat-visual-bottom-inset');
    expect(layout).not.toContain('var(--cos-tab-inset)');
  });
  it('keeps chat scroll clearance synchronized with the dock while the keyboard opens', () => {
    expect(layout).toContain('.app-shell.is-touch-layout.is-chat-route .app-content.is-chat-content');
    expect(layout).toContain('padding-bottom: var(--cos-tab-reserve) !important;');
    expect(layout).toContain('--cos-tab-reserve: calc(var(--cos-tab-height) + var(--cos-tab-safe-area));');
  });

  it('tests edge-to-edge dock placement and does not require floating-dock clearance', () => {
    expect(buildWorkflow).toContain("expect(measurement.dock?.bottom ?? -1, JSON.stringify(measurement)).toBeCloseTo(844, 0);");
    expect(buildWorkflow).toContain("expect(measurement.dock?.left ?? -1, JSON.stringify(measurement)).toBe(0);");
    expect(buildWorkflow).toContain("expect(measurement.dock?.right ?? -1, JSON.stringify(measurement)).toBe(measurement.viewportWidth);");
    expect(buildWorkflow).toContain("toBeGreaterThanOrEqual(measurement.dockHeight);");
    expect(buildWorkflow).not.toContain("dockHeight + 20");
    expect(buildWorkflow).not.toContain("contentReserve >= 84");
  });


  it('keeps a standard accessible tab row above the real iPhone safe area', () => {
    expect(layout).toContain('--cos-tab-height: 52px;');
    expect(layout).toContain('--cos-tab-safe-area: env(safe-area-inset-bottom, 0px);');
    expect(layout).toContain('--cos-tab-reserve: calc(var(--cos-tab-height) + var(--cos-tab-safe-area));');
    expect(layout).toContain('padding: 0 6px var(--cos-tab-safe-area);');
    expect(layout).toContain('height: var(--cos-tab-height);');
    expect(layout).toContain('min-height: 44px;');
    expect(layout).toContain('justify-content: flex-end;');
    expect(layout).toContain('width: 21px;');
    expect(layout).toContain('height: 21px;');
  });

});