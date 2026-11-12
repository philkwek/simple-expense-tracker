/* Ledger push-notification service worker.
 *
 * Intentionally has no fetch handler: the app shell is served and cached by
 * Vite/hosting, and this worker only exists to receive push messages and to
 * open/focus the app when a notification is tapped.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let json = {};
  try {
    json = event.data ? event.data.json() : {};
  } catch {
    json = {};
  }

  const source = json && typeof json === 'object' ? json : {};
  const payload = source.data ?? source.notification ?? source ?? {};
  const title = payload.title || 'Ledger';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag,
    data: { url: payload.url || '/' },
  };

  // Always show something: iOS terminates the push event without a notification.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target =
    (event.notification.data && event.notification.data.url) || '/';
  const url = new URL(target, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin !== self.location.origin) continue;

        if (typeof client.navigate === 'function') {
          try {
            await client.navigate(url);
          } catch {
            // A client can disappear mid-navigation; focusing it is still fine.
          }
        }
        if (typeof client.focus === 'function') {
          return client.focus();
        }
        return undefined;
      }

      return self.clients.openWindow(url);
    })(),
  );
});
