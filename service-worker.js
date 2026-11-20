const CACHE_NAME = 'eventmaps-shell-v6-peru';
const SCOPE_URL = new URL(self.registration.scope);
const APP_SHELL = ['./payment-settings.js', './map-premium.css', './', './index.html', './app.js', './firebase-config.js', './manifest.webmanifest', './privacy.html', './favicon-32.png', './apple-touch-icon.png', './icon-192.png', './icon-512.png'];
const inScope = url => url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_URL.pathname);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('eventmaps-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
async function remember(request, response) {
  if (response && response.status === 200 && response.type !== 'opaque') {
    try {const cache = await caches.open(CACHE_NAME);await cache.put(request, response.clone());} catch (_) {}
  }
  return response;
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const own = inScope(url);
  const cdn = ['cdnjs.cloudflare.com', 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'].includes(url.hostname);
  if (!own && !cdn) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (!own) {const hit = await cache.match(event.request);if (hit) return hit;}
    try {return await remember(event.request, await fetch(event.request));}
    catch (_) {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const publicEntry = url.pathname === SCOPE_URL.pathname || url.pathname === new URL('index.html', SCOPE_URL).pathname;
      if (own && event.request.mode === 'navigate' && publicEntry) {const shell = await cache.match(new URL('index.html', SCOPE_URL).href);if (shell) return shell;}
      return Response.error();
    }
  })());
});
function notificationTarget(raw) {
  try {const url = new URL(raw || './', SCOPE_URL);if (inScope(url)) return url.href;} catch (_) {}
  return SCOPE_URL.href;
}
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = notificationTarget(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    for (const client of windows) {
      if (inScope(new URL(client.url))) {try {await client.navigate(target);await client.focus();return;} catch (_) {}}
    }
    return self.clients.openWindow(target);
  })());
});
self.addEventListener('push', event => {
  let payload = {};
  try {payload = event.data ? event.data.json() : {};} catch (_) {payload = {data:{body:event.data?.text() || ''}};}
  const d = payload?.data || payload?.notification || {};
  event.waitUntil(self.registration.showNotification(d.title || 'EventMaps', {body:d.body || '',tag:d.tag || undefined,icon:'./icon-192.png',badge:'./favicon-32.png',data:{url:notificationTarget(d.url)}}));
});
