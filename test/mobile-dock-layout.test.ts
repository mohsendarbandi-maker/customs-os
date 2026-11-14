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

  it('pins the five-tab dock flush to both side edges and the bottom edge', () => {
    expect(layout).toContain('left: 0 !important;');
    expect(layout).toContain('right: 0 !important;');
    expect(layout).toContain('bottom: 0 !important;');
    expect(layout).toContain('width: 100% !important;');
    expect(layout).toContain('max-width: none !important;');
    expect(layout).toContain('height: var(--cos-tab-reserve) !important;');
  });

  it('reserves exactly the visible dock height in the scrollable page area', () => {
    expect(layout).toContain('--cos-tab-reserve: calc(var(--cos-tab-height, 70px) + env(safe-area-inset-bottom));');
    expect(layout).toContain('padding-bottom: var(--cos-tab-reserve) !important;');
  });

  it('keeps the dock flush above the keyboard without a stale floating inset', () => {
    expect(layout).toContain('bottom: var(--mobile-keyboard-bottom-inset, 0px) !important;');
    expect(layout).toContain('bottom: var(--chat-visual-bottom-inset, 0px) !important;');
    expect(layout).not.toContain('bottom: calc(var(--chat-visual-bottom-inset,0px) + var(--cos-tab-inset)');
  });
  it('keeps chat scroll clearance synchronized with the dock while the keyboard opens', () => {
    expect(layout).toContain('.app-shell.is-touch-layout.is-chat-route .app-content.is-chat-content');
    expect(layout).toContain('padding-bottom: var(--cos-tab-reserve) !important;');
    expect(layout).toContain('--cos-tab-reserve: var(--cos-tab-height, 70px);');
  });

  it('tests edge-to-edge dock placement and does not require floating-dock clearance', () => {
    expect(buildWorkflow).toContain("expect(measurement.dock?.bottom ?? -1, JSON.stringify(measurement)).toBeCloseTo(844, 0);");
    expect(buildWorkflow).toContain("expect(measurement.dock?.left ?? -1, JSON.stringify(measurement)).toBe(0);");
    expect(buildWorkflow).toContain("expect(measurement.dock?.right ?? -1, JSON.stringify(measurement)).toBe(measurement.viewportWidth);");
    expect(buildWorkflow).toContain("toBeGreaterThanOrEqual(measurement.dockHeight);");
    expect(buildWorkflow).not.toContain("dockHeight + 20");
    expect(buildWorkflow).not.toContain("contentReserve >= 84");
  });

});
