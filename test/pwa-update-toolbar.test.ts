import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const lifecycle = fs.readFileSync(path.resolve(__dirname, '../src/features/reminders/PwaLifecycle.tsx'), 'utf8');
const main = fs.readFileSync(path.resolve(__dirname, '../src/main.tsx'), 'utf8');
const shell = fs.readFileSync(path.resolve(__dirname, '../src/components/AppShell.tsx'), 'utf8');

describe('PWA update toolbar control', () => {
  it('does not render the blocking update notice or its updating message', () => {
    expect(lifecycle).not.toContain('pwa-version-notice');
    expect(lifecycle).not.toContain('نسخهٔ جدید آماده است');
    expect(lifecycle).not.toContain('در حال به‌روزرسانی…');
  });

  it('keeps updates manual and requests activation through the toolbar event', () => {
    expect(main).toContain("customs-os:pwa-update-ready");
    expect(main).toContain("customs-os:pwa-update-request");
    expect(main).toContain('void updateServiceWorker().catch');
    expect(lifecycle).not.toContain('registerSW(');
    expect(lifecycle).not.toContain('hasUnsavedWork');
    expect(shell).toContain("customs-os:pwa-update-ready");
    expect(shell).toContain("customs-os:pwa-update-request");
  });

  it('offers a compact refresh icon in both desktop and mobile headers', () => {
    expect(shell).toContain('RefreshCw');
    expect(shell).toContain('pwaUpdateAvailable && (');
    expect(shell).toContain('animate-spin');
    expect(shell).toContain('app-mobilebar');
    expect(shell).toContain('app-topbar');
  });

  it('clears the busy state when activation does not take control in time', () => {
    expect(main).toContain("customs-os:pwa-update-failed");
    expect(main).toContain('Direct service worker registration failed');
  });
});
