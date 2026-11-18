import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const lifecycle = fs.readFileSync(path.join(root, 'src/features/reminders/PwaLifecycle.tsx'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/AppShell.tsx'), 'utf8');

describe('safe PWA version updates', () => {
  it('does not auto-activate or reload a waiting update while the app is in use', () => {
    expect(main).toContain('onNeedRefresh() {');
    expect(main).toContain("customs-os:pwa-update-ready");
    expect(main).toContain("customs-os:pwa-update-request");
    expect(main).toContain('void updateServiceWorker().catch');
    expect(lifecycle).not.toContain('registerSW(');
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
    expect(main).toContain("customs-os:pwa-update-failed");
    expect(main).toContain('if (!updateServiceWorker)');
  });
});
