import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Customs OS Phase 4 native mobile interactions', () => {
  const shell = read('src/components/AppShell.tsx');
  const css = read('src/styles/mobile-native-interactions-2026.css');
  const main = read('src/main.tsx');

  it('tracks the keyboard-adjusted visual viewport and publishes the dock inset', () => {
    expect(shell).toContain('window.visualViewport');
    expect(shell).toContain('--chat-visible-height');
    expect(shell).toContain('--chat-visible-top');
    expect(shell).toContain('--chat-visual-bottom-inset');
    expect(shell).toContain('focusin');
    expect(shell).toContain('focusout');
    expect(css).toContain('height: var(--chat-visible-height, 100dvh) !important');
    expect(css).toContain('bottom: var(--chat-visual-bottom-inset, 0px) !important');
  });

  it('keeps the composer in the final flex row and reserves the fixed dock height', () => {
    expect(css).toContain('.app-shell.is-chat-route .chat-composer');
    expect(css).toContain('flex: 0 0 auto !important');
    expect(css).toContain('padding: 0 0 calc(var(--cos-tab-height) + env(safe-area-inset-bottom)) !important');
    expect(css).toContain('.app-shell.is-chat-route .chat-message-area');
  });

  it('bounds large pending attachment previews so the composer cannot consume the chat viewport', () => {
    expect(css).toContain('.chat-composer [data-unsaved="true"]');
    expect(css).toContain('max-height: min(24dvh, 170px) !important');
  });

  it('makes same-tab selection a scroll-to-top action instead of a duplicate route transition', () => {
    expect(shell).toContain('const sameRoute =');
    expect(shell).toContain("scroller?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })");
    expect(shell).toContain('if (sameRoute)');
  });

  it('styles the outgoing route snapshot as a short-lived inert native transition', () => {
    expect(shell).toContain("snapshot.className = 'native-route-exit-snapshot'");
    expect(css).toContain('.native-route-exit-snapshot');
    expect(css).toContain('@keyframes cosRouteExit');
  });

  it('loads interaction fixes after the screen-level mobile layout', () => {
    const screens = main.indexOf("import './styles/mobile-native-screens-2026.css';");
    const interactions = main.indexOf("import './styles/mobile-native-interactions-2026.css';");
    expect(screens).toBeGreaterThan(-1);
    expect(interactions).toBeGreaterThan(screens);
  });
});
