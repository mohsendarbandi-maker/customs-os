import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const shell = read('src/components/AppShell.tsx');
const mobileCss = read('src/styles/mobile-polish.css');
const reminders = read('src/features/reminders/RemindersPage.tsx');

describe('single mobile shell navigation regressions', () => {
  it('mounts the sidebar only at the desktop breakpoint and omits mobile hamburger markup', () => {
    expect(shell).toContain("window.matchMedia('(min-width: 1024px) and (pointer: fine)')");
    expect(shell).toContain('{isDesktop && (');
    expect(shell).not.toContain('mobile-menu-trigger');
    expect(shell).not.toContain('customs-desktop-menu');
    expect(shell).not.toContain('className={`app-sidebar hidden md:flex');
    expect(shell).toContain('{isDesktop && <header className="app-topbar">');
  });

  it('keeps touch-first navigation when a mobile browser reports a wide viewport', () => {
    expect(shell).toContain("(min-width: 1024px) and (pointer: fine)");
    expect(mobileCss).toContain("@media (max-width: 1023px), (pointer: coarse)");
    expect(mobileCss).toContain("@media (min-width: 1024px) and (pointer: fine)");
    expect(mobileCss).not.toContain("@media (min-width: 1024px) {");
    expect(shell).toContain("{isDesktop && (");
    expect(shell).toContain('<header className="app-mobilebar"');
  });

  it('provides exactly five primary mobile tabs and a three-column More sheet', () => {
    const start = shell.indexOf('{!isDesktop && <nav className="app-mobile-dock"');
    expect(start).toBeGreaterThan(-1);
    const dock = shell.slice(start, shell.indexOf('</nav>}', start));
    expect(dock.match(/<button\b/g)).toHaveLength(5);
    expect(dock).toContain('خانه');
    expect(dock).toContain('عملیات');
    expect(dock).toContain('یادآورها');
    expect(dock).toContain('چت');
    expect(dock).toContain('بیشتر');
    expect(shell).toContain('className="app-more-grid"');
    expect(mobileCss).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
  });

  it('uses safe-area-aware dynamic viewport geometry and reserves content space for the dock', () => {
    expect(mobileCss).toContain('100dvh');
    expect(mobileCss).toContain('env(safe-area-inset-top)');
    expect(mobileCss).toContain('env(safe-area-inset-bottom)');
    expect(mobileCss).toContain('padding: 10px 12px calc(var(--app-mobile-tabbar-height) + env(safe-area-inset-bottom) + 18px)');
  });

  it('keeps Chat/Reminders in the shell and removes the duplicate reminders tab bar', () => {
    expect(shell).toContain("const bare = location.pathname === '/login' || location.pathname === '/onboarding'");
    expect(shell).toContain("const bare = location.pathname === '/login' || location.pathname === '/onboarding'");
    expect(shell).not.toContain("const bare = location.pathname === '/login' || location.pathname === '/chat'");
    expect(reminders).not.toContain('<nav className="reminders-mobile-nav"');
    expect(mobileCss).toContain('.app-shell:has(.chat-standalone[data-chat-selected="true"]) .app-mobile-dock');
  });

  it('keeps the tablet header flex-based and the dock grid-based', () => {
    expect(mobileCss).toContain('.app-mobilebar { display: flex !important; }');
    expect(mobileCss).toContain('.app-mobile-dock { display: grid !important; }');
    expect(mobileCss).not.toContain('.app-mobilebar, .app-mobile-dock { display: grid !important; }');
  });

  it('applies phone layout rules to 375px, 390px, and 430px viewports', () => {
    const phoneWidths = [375, 390, 430];
    expect(phoneWidths.every((width) => width <= 767)).toBe(true);
    expect(mobileCss).toContain('@media (max-width: 767px)');
    expect(mobileCss).toContain('min-width: 0 !important');
    expect(mobileCss).toContain('overflow-x: clip');
    expect(mobileCss).toContain('grid-template-columns: repeat(5, minmax(0, 1fr)) !important');
  });

  it('keeps shipment search in the page toolbar rather than as a fixed control', () => {
    const statuses = read('src/components/LatestShipmentStatuses.tsx');
    expect(statuses).toContain('className="shipment-status-search"');
    expect(mobileCss).toContain('.shipment-status-search { position: relative !important; inset: auto !important; }');
  });
});
