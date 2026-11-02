/* Serves the app from the phone instantly. Bump CACHE when a file in assets/ changes. */
const CACHE = 'fairtiq-1';
const ASSETS = ['logo.png', 'tagline.png', 'zlin.webp', 'ticket-eye.webp', 'piggy.webp', 'smartstop.webp', 'bus.png', 'shelter.png', 'ob1.png', 'ob2.png', 'ob3.png',
  'app-icon-152.png', 'app-icon-167.png', 'app-icon-180.png', 'app-icon-192.png', 'app-icon-512.png', 'icon.svg', 'bwip-js-min.js',
  ...[400, 500, 600, 700].flatMap(w => [`fonts/poppins-latin-${w}-normal.woff2`, `fonts/poppins-latin-ext-${w}-normal.woff2`])].map(f => 'assets/' + f);
const PAGES = ['index.html', 'style.css', 'app.js', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([...PAGES, ...ASSETS])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const isPage = e.request.mode === 'navigate' || !url.pathname.startsWith(scope + 'assets/');
  const key = e.request.mode === 'navigate' ? scope + 'index.html' : url.pathname;
  e.respondWith(caches.open(CACHE).then(async c => {
    const cached = await c.match(key);
    if (!isPage && cached) return cached;                 // images, fonts: straight from the phone
    const net = fetch(e.request).then(r => { if (r.ok) c.put(key, r.clone()); return r; });
    if (!cached) return net;
    // html, css, js: newest version if it arrives quickly, otherwise the saved one
    const timeout = new Promise(r => setTimeout(() => r(cached), 1200));
    return Promise.race([net.catch(() => cached), timeout]);
  }));
});
