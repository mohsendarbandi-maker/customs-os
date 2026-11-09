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

describe('premium native mobile workspace', () => {
  it('loads the premium mobile layer after every existing visual layer', () => {
    const premiumImport = main.indexOf("import './styles/mobile-app-premium.css';");
    const referenceImport = main.indexOf("import './styles/mobile-reference-redesign.css';");
    expect(premiumImport).toBeGreaterThan(referenceImport);
  });

  it('keeps the chat composer clear of the global dock while a conversation is open', () => {
    expect(chat).toContain('data-chat-selected={selectedId?\'true\':\'false\'}');
    expect(css).toContain('html:has(.app-shell.is-chat-route .chat-standalone[data-chat-selected="true"]) .app-mobile-viewport-dock');
    expect(css).toContain('.chat-composer textarea');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(shell).toContain('aria-label="پیمایش سریع"');
  });

  it('renders every shipment, its warnings and its expanded details inside one article card', () => {
    expect(shipments).toContain('className="shipment-item-card"');
    expect(shipments).toContain('<article key={x.id}');
    expect(shipments).toContain('className="shipment-warnings"');
    expect(shipments).toContain('className="shipment-expanded"');
    expect(css).toContain('.shipment-item-card');
    expect(css).toContain('.shipment-compact-list');
  });

  it('defines meaningful page/card motion and respects reduced-motion preferences', () => {
    expect(css).toContain('@keyframes mobile-app-screen-in');
    expect(css).toContain('@keyframes mobile-app-card-in');
    expect(css).toContain('animation: mobile-app-screen-in');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('uses safe areas, compact native navigation and a non-scrolling shipment card list', () => {
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('border-radius: 23px !important');
    expect(css).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
    expect(css).toContain('overflow: visible !important');
  });
});
