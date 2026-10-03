/// <reference lib="webworker" />
import {cleanupOutdatedCaches, precacheAndRoute} from 'workbox-precaching';
import {registerRoute, setCatchHandler} from 'workbox-routing';
import {NetworkFirst} from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

const OFFLINE_CACHE = 'customs-os-offline-v2';
const PAGES_CACHE = 'customs-os-pages-v2';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.addAll(['/offline.html'])));
});

self.addEventListener('message', (event) => {
  const data = event.data as {type?: string} | string | undefined;
  if (data === 'SKIP_WAITING' || (typeof data === 'object' && data?.type === 'SKIP_WAITING')) {
    void self.skipWaiting();
  }
});

registerRoute(
  ({request, url}) => request.mode === 'navigate' && url.origin === self.location.origin,
  new NetworkFirst({cacheName: PAGES_CACHE, networkTimeoutSeconds: 5}),
);

const fallbackHtml = () =>
  new Response(
    '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Customs OS</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1220;color:#e5edf8;font-family:system-ui,sans-serif;text-align:center;padding:24px"><div><h1 style="margin:0 0 8px">در حال اتصال…</h1><p style="color:#91a1b8">اگر صفحه باز نشد، یک‌بار برنامه را ببندید و دوباره باز کنید.</p><button onclick="location.reload()" style="min-height:44px;border:0;border-radius:12px;padding:0 18px;background:#2563eb;color:#fff;font:inherit;font-weight:700">تلاش دوباره</button></div></body></html>',
    {headers: {'Content-Type': 'text/html; charset=utf-8'}},
  );

setCatchHandler(async ({request}) => {
  if (request.mode === 'navigate') {
    return (await caches.match('/offline.html')) ?? fallbackHtml();
  }
  return Response.error();
});

type PushData = {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  icon?: string;
  badge?: string;
  requireInteraction?: boolean;
  actions?: Array<{action: string; title: string; icon?: string}>;
  data?: Record<string, string>;
};
const actionUrl = (rid: string, action: string) =>
  '/reminders?rid=' + encodeURIComponent(rid) + '&act=' + encodeURIComponent(action) + '&source=push';

self.addEventListener('push', (event) => {
  const data = (event.data?.json?.() ?? {}) as PushData;
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'یادآور گمرکی', {
      body: data.body ?? 'یک یادآور برای شما ثبت شده است.',
      tag: data.tag ?? 'customs-os-reminder',
      icon: data.icon ?? '/pwa/icon-192.png',
      badge: data.badge ?? '/pwa/monochrome-96.png',
      dir: 'rtl',
      lang: 'fa',
      requireInteraction: data.requireInteraction ?? false,
      ...(data.actions
        ? {actions: data.actions}
        : {
            actions: [
              {action: 'done', title: 'انجام شد'},
              {action: 'snooze10', title: '۱۰ دقیقه بعد'},
              {action: 'tomorrow9', title: 'فردا ۹ صبح'},
            ],
          }),
      data: {...(data.data ?? {}), url: data.url ?? '/reminders'},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = (n.data ?? {}) as Record<string, string>;
  const rid = data.rid ?? '';
  const action = event.action;
  n.close();
  const target = action && rid ? actionUrl(rid, action) : data.url ?? '/reminders';
  event.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(async (windows) => {
      for (const w of windows) {
        if ('focus' in w) {
          if ('navigate' in w) await w.navigate(new URL(target, self.location.origin).href);
          return w.focus();
        }
      }
      return self.clients.openWindow(new URL(target, self.location.origin).href);
    }),
  );
});

self.addEventListener('notificationclose', (event) => {
  event.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then((w) => {
      for (const c of w) c.postMessage({type: 'NOTIFICATION_CLOSED', tag: event.notification.tag});
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then((w) => {
      for (const c of w) c.postMessage({type: 'PUSH_SUBSCRIPTION_CHANGED'});
    }),
  );
});
