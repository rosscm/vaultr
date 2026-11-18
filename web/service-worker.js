self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === 'string' ? payload.title : 'New Watchlist match!';
  const body = typeof payload.body === 'string'
    ? payload.body
    : 'KeepSeek found a new match for one of your Watchlist cards.';
  const path = typeof payload.path === 'string' && payload.path.startsWith('/app') ? payload.path : '/app#alerts';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/keepseek-icon-192.png',
    badge: '/keepseek-icon-192.png',
    data: { path },
    tag: path,
    renotify: false
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.path || '/app#alerts';
  event.waitUntil((async () => {
    const target = new URL(path, self.location.origin).href;
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});
