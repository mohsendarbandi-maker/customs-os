import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');

describe('Customs OS unified native mobile shell', () => {
  const shell = read('src/components/AppShell.tsx');
  const app = read('src/App.tsx');
  const main = read('src/main.tsx');
  const styles = read('src/styles/native-mobile-shell.css');
  const chat = read('src/features/chat/ChatPage.tsx');
  const reminders = read('src/features/reminders/RemindersPage.tsx');

  it('mounts one persistent five-tab navigation in the required order', () => {
    const start = shell.indexOf('native-bottom-tabs');
    expect(start).toBeGreaterThan(-1);
    const end = shell.indexOf('</nav>', start);
    const dock = shell.slice(start, end);
    expect([...dock.matchAll(/<button\b/g)]).toHaveLength(5);
    const labels = ['خانه', 'یادآورها', 'عملیات', 'چت', 'بیشتر'];
    const positions = labels.map(label => dock.indexOf('<span>' + label + '</span>'));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(shell).toContain('isMoreTab');
  });

  it('keeps the five primary routes and More content in the same router and shell', () => {
    expect(app).toContain('path="/more"');
    expect(shell).toContain('const MobileMoreContent');
    expect(shell).toContain('isMoreRoute ?');
    expect(shell).toContain('native-more-profile');
    expect(shell).toContain('native-more-search');
    expect(shell).toContain('native-more-grid');
    expect(shell).toContain("go('/more')");
    expect(shell).toContain("go('/reminders')");
    expect(shell).toContain("go('/operations')");
    expect(shell).toContain("go('/chat')");
    expect(shell).toContain("go('/')");
  });

  it('provides a safe-area status strip, contextual header, internal scroll region and fixed tab bar', () => {
    expect(shell).toContain('native-system-status');
    expect(shell).toContain('native-app-header');
    expect(shell).toContain('className={`app-content');
    expect(styles).toContain('height: 100dvh');
    expect(styles).toContain('env(safe-area-inset-top)');
    expect(styles).toContain('overflow-y: auto');
    expect(styles).toContain('position: fixed');
    expect(styles).toContain('grid-template-columns: repeat(5');
    expect(main.indexOf("import './styles/native-mobile-shell.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/mobile-reference-final.css';"));
  });

  it('connects contextual header actions to the existing chat and reminder creation flows', () => {
    expect(shell).toContain("customs-os:reminder-compose");
    expect(shell).toContain("customs-os:chat-new-message");
    expect(reminders).toContain("addEventListener('customs-os:reminder-compose'");
    expect(chat).toContain("addEventListener('customs-os:chat-new-message'");
  });

  it('keeps screen transitions native-like and respects reduced motion', () => {
    expect(styles).toContain('native-route-enter');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('overscroll-behavior-y: contain');
  });
});
