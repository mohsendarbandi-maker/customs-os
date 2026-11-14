import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Phase 2 — keyboard-aware chat and reminder workspaces', () => {
  const reminders = read('src/features/reminders/RemindersPage.tsx');
  const chat = read('src/features/chat/ChatPage.tsx');
  const finalMobileLayer = read('src/styles/mobile-route-polish-2026.css');
  const shell = read('src/components/AppShell.tsx');
  const main = read('src/main.tsx');

  it('tracks iOS visualViewport while the quick reminder composer is open', () => {
    expect(reminders).toContain("if(!composerOpen)return;");
    expect(reminders).toContain("window.visualViewport");
    expect(reminders).toContain("viewport?.height??window.innerHeight");
    expect(reminders).toContain("viewport?.offsetTop??0");
    expect(reminders).toContain("setProperty('--reminder-visual-height'");
    expect(reminders).toContain("setProperty('--reminder-visual-top'");
    expect(reminders).toContain("viewport?.addEventListener('resize',scheduleSync)");
    expect(reminders).toContain("viewport?.addEventListener('scroll',scheduleSync)");
    expect(reminders).toContain("viewport?.removeEventListener('resize',scheduleSync)");
    expect(reminders).toContain("removeProperty('--reminder-visual-height')");
    expect(reminders).toContain("},[composerOpen]);");
  });

  it('constrains the create sheet to the visible viewport and makes its own content scrollable', () => {
    expect(finalMobileLayer).toContain('.reminders-page .reminders-composebar.is-open');
    expect(finalMobileLayer).toContain('var(--reminder-visual-top, 0px)');
    expect(finalMobileLayer).toContain('height: var(--reminder-visual-height, 100dvh)');
    expect(finalMobileLayer).toContain('max-height: var(--reminder-visual-height, 100dvh)');
    expect(finalMobileLayer).toContain('max-height: calc(var(--reminder-visual-height, 100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 18px)');
    expect(finalMobileLayer).toContain('overflow-y: auto !important');
    expect(finalMobileLayer).toContain('overscroll-behavior: contain !important');
    expect(finalMobileLayer).toContain('position: sticky !important;');
    expect(finalMobileLayer).toContain('.reminders-compose-actions .reminders-submit-button');
  });

  it('keeps reminder creation in the visible page header without adding a duplicate floating action', () => {
    expect(reminders).toContain('className="reminders-hub-add"');
    expect(reminders).toContain('onClick={openComposer}');
    expect(finalMobileLayer).not.toContain('.reminders-page .reminders-mobile-fab');
    expect(finalMobileLayer).not.toContain('bottom: calc(92px + env(safe-area-inset-bottom))');
  });

  it('keeps chat history as its own scroll region and bounds attachment previews above the composer', () => {
    expect(chat).toContain('className="chat-message-area relative flex-1 min-h-0 overflow-y-auto');
    expect(chat).toContain('className="chat-composer shrink-0');
    expect(finalMobileLayer).toContain('.app-shell.is-chat-route .chat-message-area');
    expect(finalMobileLayer).toContain('overscroll-behavior-y: contain !important');
    expect(finalMobileLayer).toContain('.app-shell.is-chat-route .chat-composer [data-unsaved="true"]');
    expect(finalMobileLayer).toContain('max-height: min(20dvh, 140px)');
    expect(finalMobileLayer).toContain('.app-shell.is-chat-route .chat-composer textarea');
    expect(finalMobileLayer).toContain('font-size: 16px !important');
  });

  it('uses the shared shell header and keeps the body-portal dock visible during an open chat', () => {
    expect(shell).toContain('window.visualViewport');
    expect(shell).toContain('--chat-visible-height');
    expect(shell).toContain('aria-label="پیمایش اصلی برنامه"');
    expect(finalMobileLayer).toContain('.app-shell.is-chat-route .chat-composer');
    expect(main.indexOf("import './styles/mobile-route-polish-2026.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/mobile-native-chat-viewport-fix-2026.css';"));
  });
});
