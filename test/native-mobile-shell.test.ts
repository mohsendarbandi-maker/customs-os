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
  const more = read('src/pages/MobileMorePage.tsx');
  const chat = read('src/features/chat/ChatPage.tsx');
  const reminders = read('src/features/reminders/RemindersPage.tsx');

  it('mounts one fixed five-tab navigation inside the application shell in the required order', () => {
    const start = shell.indexOf('data-native-tabs="5"');
    expect(start).toBeGreaterThan(-1);
    const end = shell.indexOf('</nav>', start);
    const dock = shell.slice(start, end);
    expect([...dock.matchAll(/<button\b/g)]).toHaveLength(5);
    const labels = ['خانه', 'یادآورها', 'عملیات', 'چت', 'بیشتر'];
    const positions = labels.map(label => dock.indexOf('<span>' + label + '</span>'));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(shell).toContain('app-mobile-dock app-mobile-viewport-dock');
    expect(shell).not.toContain('createPortal');
  });

  it('keeps all five primary routes and the More modules page in the same router tree', () => {
    expect(app).toContain('path="/more"');
    expect(app).toContain('MobileMorePage');
    expect(shell).toContain("navigate('/more')");
    expect(shell).toContain("navigate('/reminders')");
    expect(shell).toContain("navigate('/operations')");
    expect(shell).toContain("navigate('/chat')");
    expect(shell).toContain("navigate('/')");
  });

  it('provides one edge-to-edge viewport with a safe-area status strip, contextual header, scroll region and fixed dock', () => {
    expect(shell).toContain('app-mobile-status');
    expect(shell).toContain('className="app-mobilebar"');
    expect(shell).toContain('ref={contentScrollerRef}');
    expect(styles).toContain('height: 100dvh');
    expect(styles).toContain('env(safe-area-inset-top)');
    expect(styles).toContain('overflow-y: auto');
    expect(styles).toContain('position: fixed');
    expect(styles).toContain('grid-template-columns: repeat(5');
    expect(main.indexOf("import './styles/native-mobile-shell.css';"))
      .toBeGreaterThan(main.indexOf("import './styles/mobile-reference-final.css';"));
  });

  it('routes the More tab to a searchable role-aware module grid and profile card', () => {
    expect(more).toContain('native-profile-card');
    expect(more).toContain('native-module-search');
    expect(more).toContain('module.roles.includes(role)');
    expect(more).toContain('native-module-grid');
    expect(more).toContain("href: '/file-manager'");
    expect(more).toContain("href: '/finance'");
  });

  it('routes the shared contextual plus action to real create flows', () => {
    expect(shell).toContain("customs-os:reminder-create");
    expect(shell).toContain("customs-os:chat-create");
    expect(reminders).toContain("addEventListener('customs-os:reminder-create'");
    expect(chat).toContain("addEventListener('customs-os:chat-create'");
  });

  it('keeps the route screen transitions native-like and respects reduced motion', () => {
    expect(styles).toContain('native-route-enter');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('overscroll-behavior-y: contain');
  });
});
