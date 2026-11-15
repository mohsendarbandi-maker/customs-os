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
  const reminderTimeline = read('src/styles/reminders-timeline.css');
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

  it('hides the overdue tab and opens the reminders timeline on the Open tab by default', () => {
    expect(reminders).toContain("const TIMELINE_TABS=[{id:'all',label:'همه',section:'all'},{id:'today',label:'امروز',section:'today'},{id:'open',label:'باز',section:'open'},{id:'scheduled',label:'آینده',section:'scheduled'},{id:'done',label:'انجام‌شده',section:'done'}] as const;");
    expect(reminders).not.toContain("{id:'overdue',label:'معوق',section:'overdue'}");
    expect(reminders).toContain("pathToken==='home'?'open':pathToken");
    expect(reminders).toContain("const isHome=currentSection==='open'");
  });

  it('opens reminder actions on touch-and-hold and keeps the menu open after finger release', () => {
    expect(reminders).toContain("const timer=window.setTimeout(()=>{if(card.dataset.touchMoved==='true')return;const trigger=card.querySelector('.reminder-overflow-trigger')");
    expect(reminders).toContain("card.dataset.longPressMenu='true'");
    expect(reminders).toContain("if(card.dataset.longPressMenu==='true')delete card.dataset.longPressMenu;");
    expect(reminders).not.toContain("if(card.dataset.longPressMenu==='true'){delete card.dataset.longPressMenu;closeCardMenu();}");
    expect(reminders).toContain('onPointerCancel={onCardPointerCancel}');
    expect(reminders).toContain('onPointerMove={onCardPointerMove}');
    expect(reminders).toContain('onContextMenu={event=>event.preventDefault()}');
    expect(reminders.match(/onPointerMove={onCardPointerMove}/g)?.length).toBe(2);
    expect(reminders).toContain("Math.hypot(dx,dy)>12");
    expect(reminders).toContain("Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.3");
    expect(reminderTimeline).toContain('.reminders-app-standalone .reminder-card{-webkit-user-select:none!important;user-select:none;-webkit-touch-callout:none;touch-action:pan-y}');
    expect(reminders).not.toContain('pointerStart');
  });

  it('keeps the reminder search panel animated, keyboard-accessible, and explicitly clearable/closable', () => {
    expect(reminders).toContain('searchInputRef.current?.focus()');
    expect(reminders).toContain('searchPanelVisible');
    expect(reminders).toContain("className={'reminders-timeline-search-shell '+(isSearchPage?'is-open':'is-closing')}");
    expect(reminders).toContain("aria-label={t('پاک‌کردن جست‌وجو')}");
    expect(reminders).toContain("aria-label={t('بستن جست‌وجو')}");
    expect(reminderTimeline).toContain('.reminders-timeline-search-shell.is-closing');
    expect(reminderTimeline).toContain('prefers-reduced-motion:reduce');
  });

  it('exposes accessible loading, error, empty and live-count states in the timeline', () => {
    expect(reminders).toContain('aria-busy={statsQuery.isPending}');
    expect(reminders).toContain('className="reminders-count-loading"');
    expect(reminders).toContain('aria-label={t(\'در حال بارگذاری یادآورها\')}');
    expect(reminders).toContain('role="alert" aria-live="assertive" className="reminders-timeline-error"');
    expect(reminders).toContain('role="status" aria-live="polite" className="reminders-empty-state reminders-timeline-empty"');
  });

  it('keeps showcase, chat, reminders and theme previews within the same visual system', () => {
    expect(showcase).toContain('showcase-ship-icon');
    expect(chat).toContain('chat-conversation-view');
    expect(reminders).toContain('reminders-timeline-screen');
    expect(reminderTimeline).toContain('.reminders-timeline-card');
    expect(reminderTimeline).toContain('.reminders-timeline-tabs');
    expect(settings).toContain('visual-theme-options');
    expect(design).toContain('.shipment-showcase-page .showcase-card');
    expect(design).toContain('.chat-message-area');
    expect(design).toContain('.visual-theme-option');
  });
});
