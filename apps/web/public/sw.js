/* global self, URL */
/*
 * Curios's service worker: push notifications for owners, and nothing else.
 *
 * Deliberately no fetch handler and no cache. Every screen is live (orders, stock, chats), and a
 * saved copy shown offline could have an owner act on an order that has since changed. With no
 * fetch handler the browser loads every page exactly as it would without this file.
 *
 * The push payload is JSON from apps/workers (push.worker.ts): { title, body, url, tag? }.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Curios', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Curios';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/pwa/icon-192.png',
      badge: '/pwa/badge-96.png',
      tag: data.tag,
      // A replaced notification (same order, now paid) buzzes again: it is news.
      renotify: Boolean(data.tag),
      data: { url: data.url || '/app' },
    }),
  );
});

// Tapping opens the screen the notification is about, in a dashboard tab already open if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/app', self.location.origin);
  // Only ever our own pages: a payload is ours, but a link is never followed off the site.
  const url = target.origin === self.location.origin ? target.href : new URL('/app', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const dashboard = open.find((client) => new URL(client.url).pathname.startsWith('/app'));
      if (dashboard) {
        await dashboard.focus();
        if ('navigate' in dashboard) await dashboard.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
