import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const shell = read('src/components/AppShell.tsx');
const css = read('src/styles/mobile-chat-calendar-fix.css');
const main = read('src/main.tsx');
const chat = read('src/features/chat/ChatPage.tsx');

describe('mobile chat viewport and calendar legibility', () => {
  it('marks chat as a dedicated viewport and removes competing shell chrome', () => {
    expect(shell).toContain("const isChatRoute = location.pathname.startsWith('/chat');");
    expect(shell).toContain("isChatRoute ? 'is-chat-route' : ''");
    expect(shell).toContain("isChatRoute ? 'is-chat-main' : ''");
    expect(shell).toContain("isChatRoute ? 'is-chat-content' : ''");
    expect(shell).toContain("isChatRoute ? 'is-chat-stage' : ''");
    expect(css).toContain('.app-shell.is-chat-route .app-mobilebar');
    expect(shell).toContain('window.visualViewport');
    expect(css).toContain('var(--chat-visible-height, 100dvh)');
    expect(css).toContain('.app-shell.is-narrow-device.is-chat-route');
    expect(css).toContain('html:has(.app-shell.is-chat-route) .app-mobile-viewport-dock');
    expect(css).toContain('.app-shell.is-chat-route .app-topbar');
    expect(main).toContain("import './styles/mobile-chat-calendar-fix.css';");
  });

  it('keeps the composer visually separated and the timeline scrollable within the viewport', () => {
    expect(css).toContain('.app-shell.is-chat-route .chat-composer');
    expect(css).toContain('box-shadow: 0 8px 26px rgba(0, 0, 0, .20)');
    expect(css).toContain('.app-shell.is-chat-route .chat-message-area');
    expect(css).toContain('min-height: 0 !important');
    expect(chat).toContain('className="chat-conversation-view flex-1 min-h-0 min-w-0');
    expect(chat).toContain('className="chat-composer shrink-0');
  });

  it('increases the legibility of the Jalali date picker and every month-grid date label', () => {
    expect(css).toContain('.reminders-calendar-panel .grid.grid-cols-7 button');
    expect(css).toContain('max-height: none !important;');
    expect(css).toContain('reminders-calendar-backdrop[role="dialog"]');
    expect(css).toContain('min-height: 44px !important');
    expect(css).toContain('.reminders-calendar-cell-day');
    expect(css).toContain('font-size: 15px !important');
    expect(css).toContain('input[type="date"]');
    expect(css).toContain('color: var(--text) !important');
    expect(css).toContain('@media (max-width: 380px)');
  });

  it('renders the month calendar as seven horizontal columns and always exposes day numbers', () => {
    const remindersPage = read('src/features/reminders/RemindersPage.tsx');
    expect(remindersPage).toContain('reminders-calendar-weekday-short');
    expect(remindersPage).toContain('reminders-calendar-cell-day');
    expect(css).toContain('grid-template-columns: repeat(7, minmax(0, 1fr)) !important;');
    expect(css).toContain('-webkit-text-fill-color: var(--text) !important;');
    expect(css).toContain('.reminders-calendar-weekday-full { display: none !important; }');
    expect(css).toContain('white-space: nowrap !important;');
  });

  it('renders the date picker with explicit seven-column classes and a visible number span', () => {
    const picker = read('src/features/reminders/JalaliDateTimePicker.tsx');
    expect(picker).toContain('reminders-calendar-picker-weekdays');
    expect(picker).toContain('reminders-calendar-picker-days');
    expect(picker).toContain('reminders-calendar-picker-day-number');
    expect(css).toContain('.reminders-calendar-panel .reminders-calendar-picker-day-number');
    expect(css).toContain('overflow-y: auto !important;');
    expect(css).toContain('text-orientation: mixed !important;');
  });

  it('keeps shipment results in a horizontal grid with a readable label and bill-of-lading number', () => {
    const remindersPage = read('src/features/reminders/RemindersPage.tsx');
    expect(remindersPage).toContain('reminders-shipment-search-result');
    expect(remindersPage).toContain('reminders-shipment-selected');
    expect(css).toContain('grid-template-columns: 36px minmax(0, 1fr) 36px !important;');
    expect(css).toContain('word-break: normal !important;');
  });

});
