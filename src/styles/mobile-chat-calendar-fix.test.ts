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
    expect(css).toContain('min-height: 44px !important');
    expect(css).toContain('.reminders-calendar-cell-day');
    expect(css).toContain('font-size: 15px !important');
    expect(css).toContain('input[type="date"]');
    expect(css).toContain('color: var(--text) !important');
    expect(css).toContain('@media (max-width: 380px)');
  });
});
