import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Customs OS Phase 4 native mobile interactions', () => {
  const shell = read('src/components/AppShell.tsx');
  const css = read('src/styles/mobile-native-interactions-2026.css');
  const main = read('src/main.tsx');
  const legacyMobileCss = read('src/styles/mobile-polish.css');

  it('tracks the keyboard-adjusted visual viewport and publishes the dock inset', () => {
    expect(shell).toContain('window.visualViewport');
    expect(shell).toContain('--chat-visible-height');
    expect(shell).toContain('--chat-visible-top');
    expect(shell).toContain('--chat-visual-bottom-inset');
    expect(shell).toContain('focusin');
    expect(shell).toContain('focusout');
    expect(css).toContain('height: var(--chat-visible-height, 100dvh) !important');
    expect(css).toContain('bottom: var(--chat-visual-bottom-inset, 0px) !important');
    expect(css).toContain('height: calc(var(--cos-tab-height) + env(safe-area-inset-bottom)) !important');
    expect(css).toContain('inset-block-end: var(--chat-visual-bottom-inset, 0px) !important');
    expect(css).toContain('.app-shell.is-touch-layout.is-chat-route .app-content.is-chat-content');
    expect(css).toContain('.chat-standalone[data-chat-selected="true"] .chat-composer');
    expect(css).toContain('margin-block-end: 0 !important');
  });

  it('tracks the visible keyboard viewport for every mobile route without hiding the dock', () => {
    expect(shell).toContain('if (isDesktop) return;');
    expect(shell).toContain('const shell = appShellRef.current;');
    expect(shell).toContain('const keyboardOpen = hasEditableFocus()');
    expect(shell).toContain('keyboardBottomInset = keyboardOpen ? visibleBottomInset : 0');
    expect(shell).toContain("document.addEventListener('focusin', scheduleSync, true)");
    expect(shell).toContain("document.addEventListener('focusout', scheduleSync, true)");
    expect(shell).toContain("shell.classList.toggle('is-mobile-keyboard-open', keyboardOpen)");
    expect(css).toContain('.app-shell.is-touch-layout.is-mobile-keyboard-open');
    expect(css).toContain('--mobile-visible-viewport-height');
    expect(css).toContain('--mobile-keyboard-bottom-inset');
    expect(css).toContain('html:has(.app-shell.is-touch-layout.is-mobile-keyboard-open) .app-mobile-viewport-dock');
    expect(css).toContain('inset-block-end: calc(var(--mobile-keyboard-bottom-inset, 0px)');
    expect(css).toContain('display: grid !important');
    expect(css).toContain('visibility: visible !important');
    expect(legacyMobileCss).not.toContain('html:has(.app-shell input:focus) .app-mobile-viewport-dock');
    expect(css).not.toContain('is-mobile-keyboard-open .app-mobile-viewport-dock { display: none');
  });

  it('keeps one vertical page scroller and allows intentional horizontal touch regions', () => {
    expect(css).toContain('.app-shell.is-touch-layout .app-content {');
    expect(css).toContain('overscroll-behavior-y: contain');
    expect(css).toContain('-webkit-overflow-scrolling: touch');
    expect(css).toContain('.app-content :is(.overflow-x-auto, [data-horizontal-scroll])');
    expect(css).toContain('overflow-x: auto !important');
    expect(css).toContain('overscroll-behavior-x: contain !important');
    expect(css).toContain('touch-action: pan-x pan-y');
    expect(css).toContain('scroll-margin-block: 18px');
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
