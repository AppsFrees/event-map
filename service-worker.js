const CACHE_NAME = 'eventmaps-shell-v3';
const APP_SHELL = [
  './', './index.html', './app.js', './firebase-config.js', './manifest.webmanifest', './privacy.html',
  './favicon-32.png', './apple-touch-icon.png', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

// Red primero para archivos propios (siempre la versión más nueva), caché como respaldo sin conexión.
// Caché primero para librerías versionadas de CDN. Nunca se cachean Firestore, Auth, teselas ni geocodificación.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const own = url.origin === self.location.origin;
  const cdn = ['cdnjs.cloudflare.com', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'].includes(url.hostname);
  if (!own && !cdn) return;
  if (own) {
    event.respondWith(fetch(event.request).then(res => {
      if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(event.request, copy)); }
      return res;
    }).catch(() => caches.match(event.request).then(r => r || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
    if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(event.request, copy)); }
    return res;
  })));
});

// Al tocar una notificación, abre (o enfoca) la app en la ficha del negocio.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope)) { c.focus(); c.navigate(target); return; } }
    return self.clients.openWindow(target);
  }));
});

// Notificaciones push de Cloud Messaging (mensajes de solo datos enviados por GitHub Actions).
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = { data: { body: event.data && event.data.text() } }; }
  const d = payload.data || payload.notification || {};
  event.waitUntil(self.registration.showNotification(d.title || 'EventMaps', {
    body: d.body || '', tag: d.tag || undefined, icon: './icon-192.png', badge: './favicon-32.png',
    data: { url: d.url || './' }
  }));
});
