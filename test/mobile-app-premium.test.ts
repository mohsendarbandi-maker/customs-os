import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const css = read('src/styles/mobile-app-premium.css');
const main = read('src/main.tsx');
const shell = read('src/components/AppShell.tsx');
const chat = read('src/features/chat/ChatPage.tsx');
const shipments = read('src/components/LatestShipmentStatuses.tsx');
const showcase = read('src/pages/ShipmentShowcasePage.tsx');
const worker = read('worker/index.ts');

describe('premium native mobile workspace', () => {
  it('loads the final mobile layer after all legacy visual layers', () => {
    const premiumImport = main.indexOf("import './styles/mobile-app-premium.css';");
    const referenceImport = main.indexOf("import './styles/mobile-reference-redesign.css';");
    expect(premiumImport).toBeGreaterThan(referenceImport);
  });

  it('keeps the chat composer above the keyboard and away from the global dock', () => {
    expect(chat).toContain('data-chat-selected={selectedId?\'true\':\'false\'}');
    expect(css).toContain('html:has(.app-shell.is-chat-route .chat-standalone[data-chat-selected="true"]) .app-mobile-viewport-dock');
    expect(css).toContain('.chat-composer textarea');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(shell).toContain('aria-label="پیمایش سریع"');
  });

  it('renders every active shipment as a dedicated, data-backed visual card', () => {
    expect(shipments).toContain("className={'shipment-premium-card ' + tone}");
    expect(shipments).toContain('shipment-premium-steps');
    expect(shipments).toContain('shipment-premium-facts');
    expect(shipments).toContain('shipment-premium-warnings');
    expect(shipments).toContain('shipment-premium-expanded');
    expect(css).toContain('.shipment-premium-card {');
    expect(css).toContain('.shipment-premium-steps');
    expect(css).toContain('.shipment-premium-facts');
  });

  it('overrides legacy fixed-width shipment rows so phones never need horizontal scrolling', () => {
    expect(css).toContain('.shipment-compact-row,');
    expect(css).toContain('width: 100%!important; min-width: 0!important; max-width: 100%!important;');
    expect(css).toContain('.shipment-board-grid');
    expect(css).toContain('grid-template-columns: minmax(0,1fr)!important');
  });

  it('renders a separate shipment showcase as a one-column mobile card gallery', () => {
    expect(showcase).toContain('showcase-card fm-showcase-card ');
    expect(css).toContain('.shipment-showcase-page .showcase-grid');
    expect(css).toContain('.shipment-showcase-page .showcase-card');
    expect(css).toContain('.fm-showcase-pagination');
    expect(css).toContain('.showcase-footer-note { display: none!important; }');
    expect(showcase).toContain('const deviceWidth = Math.min(window.innerWidth, window.screen?.width || window.innerWidth)');
    expect(showcase).toContain('setPageSize(deviceWidth < 650 ? 500');
  });

  it('keeps the mobile host on the app shell and honors the dedicated hostname', () => {
    expect(shell).toContain("window.location.hostname.toLowerCase() === 'mobile.darbandicommercial.ir'");
    expect(worker).toContain("url.hostname.toLowerCase() === 'mobile.darbandicommercial.ir'");
    expect(worker).toContain('X-Customs-OS-Build');
  });

  it('offers an explicit mobile PWA update action when a new app shell is ready', () => {
    expect(shell).toContain('className="app-pwa-update-prompt"');
    expect(shell).toContain('{pwaUpdateAvailable && !isDesktop && (');
    expect(css).toContain('.app-pwa-update-prompt');
  });

  it('defines page, card and panel motion and respects reduced-motion preferences', () => {
    expect(css).toContain('@keyframes mobile-app-screen-in');
    expect(css).toContain('@keyframes shipment-premium-enter');
    expect(css).toContain('@keyframes shipment-premium-detail-in');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });
});
