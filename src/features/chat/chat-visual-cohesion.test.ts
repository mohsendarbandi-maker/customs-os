import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const styles = read('src/styles/chat-reminders-cohesion.css');
const reminders = read('src/features/reminders/RemindersPage.tsx');
const chatPage = read('src/features/chat/ChatPage.tsx');
const hierarchy = read('src/features/chat/ChatHierarchyPanel.tsx');
const logo = read('src/features/chat/ChatBrandLogo.tsx');
const main = read('src/main.tsx');

describe('shared visual language and chat layout regressions', () => {
  it('loads the cohesion layer after the existing responsive styles', () => {
    expect(main).toContain("import './styles/chat-reminders-cohesion.css';");
    expect(main.indexOf("import './styles/chat-reminders-cohesion.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/reminders-redesign.css';"));
  });

  it('uses the site-level appearance instead of a reminders-only theme', () => {
    expect(reminders).not.toContain("customs-reminders-theme-v1");
    expect(reminders).not.toContain('setTheme(');
    expect(reminders).not.toContain('data-theme={theme}');
    expect(reminders).toContain('رنگ‌بندی و حالت روشن/تیره از تنظیمات ظاهری اصلی Customs OS پیروی می‌کند.');
    expect(styles).toContain('background: var(--bg) !important');
  });

  it('prevents the chat brand and connection status from overlapping', () => {
    expect(chatPage).toContain('className="chat-app-header-main"');
    expect(styles).toContain('.chat-standalone .chat-app-header-main');
    expect(styles).toContain('.chat-standalone .chat-app-brand > span');
    expect(styles).toContain('text-overflow: ellipsis');
    expect(styles).toContain('@media (max-width: 380px)');
  });

  it('uses the current site primary color for the chat brand mark', () => {
    expect(logo).toContain('var(--primary)');
    expect(logo).not.toContain('#0b7ea4');
    expect(logo).not.toContain('#075a78');
  });

  it('renders compact, accessible group and owner/shipment rows', () => {
    expect(chatPage).toContain('chat-conversation-panel-heading');
    expect(hierarchy).toContain('chat-conversation-row');
    expect(hierarchy).toContain('chat-owner-card');
    expect(hierarchy).toContain('chat-shipment-row');
    expect(hierarchy).toContain('aria-expanded={expanded}');
    expect(styles).toContain('.chat-owner-card');
    expect(styles).toContain('.chat-shipment-row.is-selected');
  });

  it('keeps the visual layer bound to global design tokens and adapts to phone/tablet/desktop', () => {
    for (const token of ['var(--primary)', 'var(--surface)', 'var(--surface-2)', 'var(--border)', 'var(--text)', 'var(--text-muted)']) {
      expect(styles).toContain(token);
    }
    expect(styles).toContain('@media (max-width: 767px)');
    expect(styles).toContain('@media (min-width: 768px)');
    expect(styles).toContain('env(safe-area-inset-top)');
  });
});
