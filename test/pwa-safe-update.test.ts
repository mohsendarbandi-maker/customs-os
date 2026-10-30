import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const lifecycle = fs.readFileSync(path.join(root, 'src/features/reminders/PwaLifecycle.tsx'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/AppShell.tsx'), 'utf8');

describe('safe PWA version updates', () => {
  it('does not auto-activate or reload a waiting update while the app is in use', () => {
    expect(lifecycle).toContain('onNeedRefresh: () => {');
    expect(lifecycle).toContain("customs-os:pwa-update-ready");
    expect(lifecycle).toContain("customs-os:pwa-update-request");
    expect(lifecycle).toContain('await activate(false)');
    expect(lifecycle).not.toContain('document.visibilityState !== \'visible\'');
    expect(lifecycle).not.toContain('hasUnsavedWork()');
    expect(lifecycle).not.toContain('void activate(true).catch');
    expect(lifecycle).not.toContain('pwa-version-notice');
  });

  it('keeps manual activation available through a small toolbar icon', () => {
    expect(shell).toContain('pwaUpdateAvailable');
    expect(shell).toContain('RefreshCw');
    expect(shell).toContain("customs-os:pwa-update-request");
    expect(shell).toContain('animate-spin');
    expect(lifecycle).toContain("customs-os:pwa-update-failed");
    expect(lifecycle).toContain('}, 12000)');
  });
});
