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
const appShell = read('src/components/AppShell.tsx');
const aiStyles = read('src/styles/ai-workspace.css');
const reminderI18n = read('src/features/reminders/reminderI18n.ts');
const datePicker = read('src/features/reminders/JalaliDateTimePicker.tsx');

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
    expect(styles).toContain('background: transparent !important');
  });

  it('renders Jalali years without thousands separators in every calendar header', () => {
    expect(reminderI18n).toContain('useGrouping:false');
    expect(reminders).toContain('reminderYear(calendarMonth.year,language)');
    expect(datePicker).toContain('reminderYear(year,language)');
    expect(reminders).not.toContain('reminderNumber(calendarMonth.year,language)');
  });

  it('keeps the reminders calendar accent bound to site-wide appearance tokens', () => {
    expect(styles).toContain('.reminders-app-standalone .reminders-calendar-today');
    expect(styles).toContain('background: var(--primary) !important');
    expect(styles).toContain('.reminders-app-standalone .reminders-calendar-cell-count');
    expect(styles).toContain('color: var(--primary) !important');
  });

  it('keeps the chat message actions menu inside the viewport using a fixed portal', () => {
    expect(chatPage).toContain("import{createPortal}from'react-dom';");
    expect(chatPage).toContain('getBoundingClientRect()');
    expect(chatPage).toContain('className="chat-message-actions-menu"');
    expect(chatPage).toContain('document.body');
    expect(chatPage).toContain('chat-message-actions-dismiss');
    expect(styles).toContain('.chat-message-actions-menu');
    expect(styles).toContain('position: fixed;');
  });

  it('keeps the floating AI launchers out of Chat while preserving the shared assistant elsewhere', () => {
    expect(appShell).toContain("!location.pathname.startsWith('/chat') && <AIWorkspace pageContext={location.pathname + location.search} />");
    expect(chatPage).not.toContain('ChatAIOperatorPanel');
    expect(chatPage).not.toContain('onOpenAi=');
    expect(main).toContain("import './styles/ai-workspace.css';");
    expect(aiStyles).toContain('.ai-launcher');
    expect(aiStyles).toContain('.ai-chat-panel');
    expect(aiStyles).toContain('var(--primary)');
  });

  it('prevents the chat brand and connection status from overlapping', () => {
    expect(chatPage).toContain('className="chat-app-header-main"');
    expect(styles).toContain('.chat-standalone .chat-app-header-main');
    expect(styles).toContain('.chat-standalone .chat-app-brand > span');
    expect(styles).toContain('text-overflow: ellipsis');
    expect(styles).toContain('min-width: 0;');
    expect(styles).not.toContain('min-width: max-content;');
    expect(styles).toContain('@media (max-width: 380px)');
  });

  it('uses the current site primary color for the chat brand mark', () => {
    expect(logo).toContain('var(--primary)');
    expect(logo).not.toContain('#0b7ea4');
    expect(logo).not.toContain('#075a78');
  });

  it('keeps the selected conversation and composer in a min-height-zero flex column', () => {
    expect(chatPage).toContain('className="chat-conversation-view flex-1 min-h-0 min-w-0');
    expect(chatPage).toContain('className="chat-composer shrink-0');
    expect(styles).toContain('.chat-standalone .chat-message-area');
    expect(styles).toContain('.chat-standalone .chat-composer');
    expect(styles).toContain('display: flex !important');
  });

  it('removes the redundant explanatory line and compacts both inbox headings', () => {
    expect(chatPage).not.toContain('فهرست گفتگوهای سازمان');
    expect(chatPage).toContain('chat-search-row');
    expect(chatPage).toContain('h-10 rounded-xl');
    expect(styles).toContain('min-height: 50px !important');
    expect(styles).toContain('chat-quick-nav-item');
  });

  it('shows owner/shipment unread activity in a single hierarchy row per conversation', () => {
    expect(hierarchy).toContain('buildChatInboxRows(conversations,folder)');
    expect(hierarchy).toContain('chat-owner-new-activity');
    expect(hierarchy).toContain('chat-owner-open-chat');
    expect(hierarchy).toContain('shipment.last_message_body');
    expect(hierarchy).toContain('aria-expanded={expanded}');
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


  it('opens the requested conversation when a push notification deep-links into chat', () => {
    expect(chatPage).toContain("const requestedConversationId=searchParams.get('conversation')");
    expect(chatPage).toContain('if(requestedConversationId)setSelectedId(requestedConversationId)');
  });

  it('does not expose scan status or block attachment links in the chat timeline', () => {
    expect(chatPage).not.toContain('فایل در حال بررسی امنیتی است…');
    expect(chatPage).not.toContain("a.security_status==='clean'");
    expect(chatPage).not.toContain("a.security_status==='blocked'");
    expect(chatPage).not.toContain('فایل مسدود شد.');
    expect(chatPage).toContain("map(a=>a.url?(a.mime_type.startsWith('audio/')");
  });
});
