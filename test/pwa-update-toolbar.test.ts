import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const lifecycle = fs.readFileSync(path.resolve(__dirname, '../src/features/reminders/PwaLifecycle.tsx'), 'utf8');
const shell = fs.readFileSync(path.resolve(__dirname, '../src/components/AppShell.tsx'), 'utf8');

describe('PWA update toolbar control', () => {
  it('does not render the blocking update notice or its updating message', () => {
    expect(lifecycle).not.toContain('pwa-version-notice');
    expect(lifecycle).not.toContain('نسخهٔ جدید آماده است');
    expect(lifecycle).not.toContain('در حال به‌روزرسانی…');
  });

  it('keeps updates manual and requests activation through the toolbar event', () => {
    expect(lifecycle).toContain("customs-os:pwa-update-ready");
    expect(lifecycle).toContain("customs-os:pwa-update-request");
    expect(lifecycle).toContain('await activate(false)');
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
    expect(lifecycle).toContain('}, 12000)');
    expect(lifecycle).toContain("customs-os:pwa-update-failed");
    expect(lifecycle).toContain("removeEventListener('controllerchange'");
  });
});
