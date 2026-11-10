import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');

describe('maritime six-screen mobile reference', () => {
  const main = read('src/main.tsx');
  const design = read('src/styles/mobile-reference-final.css');
  const dashboard = read('src/pages/DesktopHomePage.tsx');
  const shipmentCards = read('src/components/LatestShipmentStatuses.tsx');
  const shipmentForm = read('src/pages/ShipmentFirstPage.tsx');
  const shipmentDetail = read('src/pages/FinanceShipmentPage.tsx');
  const showcase = read('src/pages/ShipmentShowcasePage.tsx');
  const chat = read('src/features/chat/ChatPage.tsx');
  const reminders = read('src/features/reminders/RemindersPage.tsx');
  const settings = read('src/pages/SettingsEnterprisePage.tsx');

  it('loads the maritime reference layer after the premium override layer', () => {
    expect(main.indexOf("import './styles/mobile-reference-final.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/mobile-app-premium.css';"));
  });

  it('restores the illustrated ocean dashboard and uses the signed-in profile greeting', () => {
    expect(design).toContain("url('/mobile-ocean-hero.svg')");
    expect(design).toContain('.mobile-ocean-highlight');
    expect(design).toContain('grid-template-columns:repeat(2,minmax(0,1fr))');
    expect(dashboard).toContain('سلام، {profile?.full_name');
  });

  it('renders vessel artwork and a five-stage operational rail in shipment cards', () => {
    expect(shipmentCards).toContain('shipment-premium-thumb');
    expect(shipmentCards).toContain('src="/mobile-ocean-hero.svg"');
    expect(shipmentCards).toContain('shipment-premium-steps');
    expect(design).toContain('.shipment-premium-thumb');
  });

  it('styles the live shipment registration stepper and white form surfaces', () => {
    expect(shipmentForm).toContain('shipment-mobile-stepper');
    expect(design).toContain('.shipment-first-page .shipment-mobile-stepper');
    expect(design).toContain('.shipment-first-page input');
  });

  it('adds data-backed shipment detail progress and facts', () => {
    expect(shipmentDetail).toContain('shipment-detail-maritime-hero');
    expect(shipmentDetail).toContain('shipment-detail-progress');
    expect(shipmentDetail).toContain('s.net_weight_kg');
    expect(design).toContain('.shipment-detail-progress-step');
  });

  it('keeps showcase, chat, reminders and theme previews within the same visual system', () => {
    expect(showcase).toContain('showcase-ship-icon');
    expect(chat).toContain('chat-conversation-view');
    expect(reminders).toContain('reminders-hub-screen');
    expect(settings).toContain('visual-theme-options');
    expect(design).toContain('.shipment-showcase-page .showcase-card');
    expect(design).toContain('.chat-message-area');
    expect(design).toContain('.reminders-open-task');
    expect(design).toContain('.visual-theme-option');
  });
});
