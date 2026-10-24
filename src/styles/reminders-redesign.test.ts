import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const css = read('src/styles/reminders-redesign.css');
const main = read('src/main.tsx');

describe('Reminders responsive redesign contract', () => {
  it('loads the redesign after the legacy responsive layers', () => {
    expect(main).toContain("import './styles/reminders-redesign.css';");
    expect(main.indexOf("import './styles/reminders-redesign.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/design-system.css';"));
  });

  it('keeps a seven-column Jalali calendar with bounded, legible day targets', () => {
    expect(css).toContain('grid-template-columns: repeat(7, minmax(0, 1fr)) !important');
    expect(css).toContain('.reminders-calendar-cell[aria-pressed="true"]');
    expect(css).toContain('min-height: 54px !important');
    expect(css).toContain('.reminders-calendar-day-dialog');
  });

  it('keeps reminder writing readable and prevents the editor from being height-clipped', () => {
    expect(css).toContain('.reminders-smart-input');
    expect(css).toContain('font-size: 16px !important');
    expect(css).toContain('overflow-y: auto !important');
    expect(css).toContain('.reminders-compose-actions .reminders-submit-button');
  });

  it('keeps theme choices readable and reflects the selected theme', () => {
    expect(css).toContain('.reminders-theme-options button.is-active');
    expect(css).toContain('.reminders-app-standalone[data-theme="dark"]');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) !important');
  });

  it('defines phone, tablet, desktop, and short-landscape layouts', () => {
    expect(css).toContain('@media (max-width: 767px)');
    expect(css).toContain('@media (min-width: 768px) and (max-width: 1023px)');
    expect(css).toContain('@media (min-width: 1024px)');
    expect(css).toContain('@media (max-height: 520px) and (orientation: landscape)');
    expect(css).toContain('@media (min-width: 1024px) and (pointer: coarse)');
  });

  it('stacks the composer and date sheets above the shared mobile navigation', () => {
    expect(css).toContain(':has(.reminders-composebar.is-open)');
    expect(css).toContain('z-index: 340 !important');
    expect(css).toContain('z-index: 330 !important');
  });

  it('preserves safe areas, reduced-motion preferences, and horizontal overflow protection', () => {
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('overflow-x: clip');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
