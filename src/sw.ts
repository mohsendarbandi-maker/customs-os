/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = 'customs-os-shell-v1';
const SHELL_CACHE = CACHE_VERSION;
const RUNTIME_CACHE = 'customs-os-runtime-v1';

type PushData = {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  icon?: string;
  badge?: string;
  requireInteraction?: boolean;
  actions?: NotificationAction[];
  data?: Record<string, string>;
};

const openAction = (reminderId: string, action: string): string =>
  '/reminders?rid=' + encodeURIComponent(reminderId) +
  '&act=' + encodeURIComponent(action) + '&source=push';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    }),
  );
});

const cacheResponse = async (request: Request, response: Response): Promise<Response> => {
  if (response.ok && request.method === 'GET') {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => cacheResponse(request, response))
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.destination === 'document') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        return new Response('شبکه در دسترس نیست.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }),
  );
});

self.addEventListener('push', (event) => {
  const payload = (event.data?.json() ?? {}) as PushData;
  const data = payload.data ?? {};
  const reminderId = data.rid ?? '';

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'اعلان Customs OS', {
      body: payload.body ?? 'یک اعلان جدید برای شما ثبت شده است.',
      tag: payload.tag ?? (reminderId ? 'customs-os-reminder-' + reminderId : 'customs-os-notification'),
      icon: payload.icon ?? '/pwa/icon-192.png',
      badge: payload.badge ?? '/pwa/badge-96.png',
      dir: 'rtl',
      lang: 'fa',
      requireInteraction: payload.requireInteraction ?? false,
      actions: payload.actions ?? [],
      data: { ...data, url: payload.url ?? '/reminders' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  const notificationData = (event.notification.data ?? {}) as Record<string, string>;
  const reminderId = notificationData.rid ?? '';
  const action = event.action;
  event.notification.close();

  const target =
    action && reminderId
      ? openAction(reminderId, action)
      : notificationData.url ?? '/reminders';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windowClients) => {
      for (const windowClient of windowClients) {
        try {
          await windowClient.navigate(new URL(target, self.location.origin).href);
        } catch {
          // A client can disappear between matchAll and navigate.
        }
        await windowClient.focus();
        return windowClient;
      }
      return self.clients.openWindow(new URL(target, self.location.origin).href);
    }),
  );
});

self.addEventListener('notificationclose', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        client.postMessage({
          type: 'NOTIFICATION_CLOSED',
          tag: event.notification.tag,
        });
      }
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
      }
    }),
  );
});
