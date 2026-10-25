import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const responsive = read('src/responsive.css');
const remindersCohesion = read('src/styles/chat-reminders-cohesion.css');
const fileManager = read('src/pages/FileManagerPage.tsx');
const shipments = read('src/components/LatestShipmentStatuses.tsx');
const home = read('src/pages/DesktopHomePage.tsx');

describe('mobile visual cohesion regressions', () => {
  it('lets reminders inherit the global site palette and background', () => {
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
    expect(responsive).toContain('.file-manager-page-actions');
    expect(responsive).toContain('.file-manager-archive-help');
  });

  it('renders shipment progress as a labeled five-step card on phones, not a clipped 740px row', () => {
    expect(shipments).toContain('shortLabel:\'انبار\'');
    expect(shipments).toContain('className="shipment-stage-number"');
    expect(shipments).toContain('className="shipment-stage-label"');
    expect(responsive).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
    expect(responsive).toContain('.shipment-compact-row');
    expect(responsive).toContain('min-width: 0 !important');
  });

  it('removes the duplicate explanation above the shipment status card', () => {
    expect(home).toContain('<LatestShipmentStatuses/>');
    expect(home).not.toContain('مراحل عملیات در یک نگاه؛ از ثبت محموله تا خروج گمرکی');
    expect(home).not.toContain('LIVE OPERATIONS');
  });
});
