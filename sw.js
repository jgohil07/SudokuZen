/* Offline app shell.

   BUMP `CACHE` ON EVERY DEPLOY THAT TOUCHES A SHELL FILE. Non-navigation assets
   are served cache-first, and the browser only re-runs install when sw.js itself
   changes — so if the version is left alone after editing the CSS, a returning
   visitor gets the new HTML with the old CSS for one load. */
const CACHE = 'sudokuzen-v2';
const SHELL = [
  './',
  './index.html',
  './sudoku.css',
  './sudoku-core.js',
  './sudoku-state.js',
  './sudoku-ui.js',
  './sudoku-egg.js',
  './icon.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   /* let fonts go to the network */

  /* Navigations: network first so a deploy is picked up, cache as the fallback. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  /* Everything else: cache first, refreshing in the background. */
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
