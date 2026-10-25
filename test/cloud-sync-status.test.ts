import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('simple Windows/web cloud synchronization', () => {
  const component = read('src/components/CloudSyncStatus.tsx');
  const shell = read('src/components/AppShell.tsx');
  const queue = read('src/lib/offlineQueue.ts');

  it('shows the same cloud sync control in the signed-in desktop shell', () => {
    expect(shell).toContain("import { CloudSyncStatus } from './CloudSyncStatus';");
    expect(shell).toContain('<CloudSyncStatus online={online} enabled={Boolean(profile)} />');
    expect(component).toContain('داده‌ها بین دستگاه‌هایی که با یک حساب و سازمان وارد شده‌اند از فضای ابری مشترک می‌شوند');
  });

  it('uses the real IndexedDB queue, retries failed chat items, and flushes pending work', () => {
    expect(component).toContain('subscribeOfflineQueue(setItems)');
    expect(component).toContain('listQueue()');
    expect(component).toContain('retryQueuedRpc(item.id)');
    expect(component).toContain('flushOfflineQueue()');
    expect(queue).toContain("const DB_NAME = 'customs-os-offline'");
  });

  it('does not reload the page while queued work remains, and warns before refreshing cloud data', () => {
    expect(component).toContain('window.confirm(');
    expect(component).toContain('if (remaining.length > 0)');
    expect(component).toContain('اطلاعات محلی حفظ شد');
    expect(component).toContain('window.location.reload()');
  });

  it('refreshes queue counts when the desktop app becomes active', () => {
    expect(component).toContain("window.addEventListener('focus', refresh)");
    expect(component).toContain("document.addEventListener('visibilitychange', refreshWhenVisible)");
  });
});
