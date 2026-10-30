import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const serviceWorker = read('src/sw.ts');
const startup = read('index.html');
const runtime = read('src/main.tsx');
const lifecycle = read('src/features/reminders/PwaLifecycle.tsx');
const queue = read('src/lib/offlineQueue.ts');
const reminders = read('src/features/reminders/RemindersPage.tsx');
const auth = read('src/context/AuthContext.tsx');

describe('offline and background-update safety', () => {
  it('uses fast network-first navigation fallback with a precached offline shell', () => {
    const navigationRoute = serviceWorker.indexOf("registerRoute(({request,url})=>request.mode==='navigate'");
    const precacheRoute = serviceWorker.indexOf('precacheAndRoute(self.__WB_MANIFEST)');
    expect(navigationRoute).toBeGreaterThan(-1);
    expect(serviceWorker).toContain("cacheName:'customs-os-navigation-v2'");
    expect(serviceWorker).toContain('networkTimeoutSeconds:1');
    expect(serviceWorker).not.toContain("new NetworkOnly()");
    expect(precacheRoute).toBeGreaterThan(navigationRoute);
    expect(serviceWorker).toContain("matchPrecache('/index.html')");
    expect(serviceWorker).toContain("matchPrecache('/offline.html')");
  });

  it('never purges service workers or offline caches during boot or chunk recovery', () => {
    expect(startup).not.toContain('customs-os-sw-reset-v3');
    expect(startup).not.toContain('caches.delete');
    expect(runtime).not.toContain('caches.delete');
    expect(runtime).not.toContain('registration.unregister()');
    expect(runtime).toContain('registration.update()');
    expect(runtime).toContain('navigator.onLine === false');
    const recovery = runtime.slice(runtime.indexOf('const recoverFromStaleApp'), runtime.indexOf('class AppErrorBoundary'));
    expect(recovery).not.toContain('window.location.reload()');
    expect(recovery).not.toContain('window.location.assign(');
    expect(runtime).toContain('تازه‌سازی صفحه');
  });

  it('keeps service-worker updates behind the compact manual toolbar action', () => {
    expect(lifecycle).toContain('onNeedRefresh: () => {');
    expect(lifecycle).toContain("customs-os:pwa-update-ready");
    expect(lifecycle).toContain("customs-os:pwa-update-request");
    expect(lifecycle).toContain('await activate(false)');
    expect(lifecycle).not.toContain('pwa-version-notice');
    expect(lifecycle).not.toContain('setNewVersionAvailable(true)');
    expect(serviceWorker).toContain("event.data.type === 'SKIP_WAITING'");
    expect(serviceWorker).not.toContain('self.skipWaiting();\\nclientsClaim();');
  });

  it('stores query snapshots in a bounded, user-and-organization-scoped IndexedDB store', () => {
    expect(queue).toContain("const QUERY_CACHE_STORE_NAME = 'query_cache'");
    expect(queue).toContain('const DB_VERSION = 4');
    expect(queue).toContain('MAX_QUERY_CACHE_AGE_MS');
    expect(queue).toContain('MAX_AUTH_PROFILE_CACHE_AGE_MS');
    expect(queue).toContain('MAX_QUERY_CACHE_ENTRIES_PER_SCOPE');
    expect(queue).toContain('if ((await currentUserId()) !== userId) return false');
    expect(queue).toContain('if ((await currentUserId()) !== userId) return null');
    expect(queue).toContain('value.organizationId !== organizationId');
    expect(queue).toContain('let stopOfflineQueue: (() => void) | null = null');
  });

  it('uses offline snapshots for reminders, overview and calendar, and preserves quick-entry drafts per user/org', () => {
    expect(reminders).toContain('readOfflineQueryCache<QueryResult>');
    expect(reminders).toContain('readOfflineQueryCache<ReminderOverview>');
    expect(reminders).toContain('readOfflineQueryCache<CalendarReminderDate[]>');
    expect(reminders).toContain('composerDraftKey=user?.id&&profile?.organization_id');
    expect(reminders).toContain('writeDraftValue(composerDraftKey,draft)');
    expect(reminders).toContain('customs-os-reminder-composer-v2:');
    expect(auth).toContain("readOfflineQueryCache<UserProfile | null>('auth-profile', userId, userId)");
    expect(auth).toContain('offlineProfile.id === userId');
    expect(auth).toContain('offlineProfile.is_active');
  });
});
