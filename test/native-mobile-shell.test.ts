import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Customs OS native unified mobile shell', () => {
  const shell = read('src/components/AppShell.tsx');
  const app = read('src/App.tsx');
  const main = read('src/main.tsx');
  const styles = read('src/styles/native-app-shell.css');

  it('keeps a single contextual mobile header and a distinct system safe-area strip', () => {
    expect(shell).toContain('native-system-status');
    expect(shell).toContain('native-app-header');
    expect(shell).toContain('{currentPageLabel}');
    expect(styles).toContain('.native-system-status');
    expect(styles).toContain('.native-app-header');
  });

  it('renders exactly the five requested primary tabs in the required RTL order', () => {
    const start = shell.indexOf('aria-label="پیمایش اصلی برنامه"');
    const end = shell.indexOf('</nav>, document.body)', start);
    const dock = shell.slice(start, end);
    const labels = ['خانه', 'یادآورها', 'عملیات', 'چت', 'بیشتر'];
    const indexes = labels.map(label => dock.indexOf('<span>' + label + '</span>'));
    expect(indexes.every(index => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect((dock.match(/<button type="button"/g) || []).length).toBe(5);
    expect(dock).toContain("go('/more')");
  });

  it('uses a shell-owned full-screen More module with profile and searchable module grid', () => {
    expect(app).toContain('path="/more"');
    expect(shell).toContain('native-more-profile');
    expect(shell).toContain('native-more-search');
    expect(shell).toContain('native-more-grid');
    expect(styles).toContain('.native-more-page');
  });

  it('keeps every module in the same keyed route stage and scroll viewport', () => {
    expect(shell).toContain('future-route-stage');
    expect(shell).toContain('key={location.pathname + location.search}');
    expect(styles).toContain('.app-content');
    expect(styles).toContain('.future-route-stage');
    expect(styles).toContain('.native-bottom-tabs');
    expect(styles).toContain('height: 100dvh');
  });

  it('prevents the chat module from creating a second global header or hiding the primary tabs', () => {
    expect(styles).toContain('.chat-app-header { display: none !important; }');
    expect(styles).toContain('.app-shell.is-chat-route .chat-composer');
    expect(styles).toContain('.app-shell.is-chat-route .app-mobile-dock.native-bottom-tabs');
  });

  it('routes contextual header actions into real module workflows', () => {
    expect(shell).toContain('customs-os:reminder-compose');
    expect(shell).toContain('customs-os:chat-new-message');
    expect(shell).toContain("go('/operations?tab=pre-declaration')");
    expect(read('src/features/reminders/RemindersPage.tsx')).toContain("addEventListener('customs-os:reminder-compose'");
    expect(read('src/features/chat/ChatPage.tsx')).toContain("addEventListener('customs-os:chat-new-message'");
  });

  it('restores and remembers scroll in the mobile content viewport rather than the document', () => {
    expect(shell).toContain("document.querySelector<HTMLElement>('.app-shell .app-content')");
    expect(shell).toContain('mobileScroller?.scrollTo');
    expect(shell).toContain('mobileScroller?.scrollTop');
    expect(styles).toContain('overflow-y: auto !important');
  });

  it('loads the native shell layer after legacy mobile overrides', () => {
    expect(main.indexOf("import './styles/native-app-shell.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/mobile-reference-final.css';"));
  });
});
