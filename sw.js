// Garde l'appli et le modèle de détourage en cache pour qu'ils marchent hors ligne
const CACHE = 'garde-robe-v6';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'facts.js', 'manifest.json', 'icons/icon-180.png', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'garde-robe-libs').map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Bibliothèques et modèle : cache d'abord (ils ne changent pas)
  if (u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'staticimgly.com') {
    e.respondWith(caches.open('garde-robe-libs').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
    return;
  }
  // Fichiers de l'appli : réseau d'abord, cache si hors ligne
  if (u.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
  }
});
