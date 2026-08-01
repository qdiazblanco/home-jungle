// Service worker: atomic app-shell precache, versioned per deploy.
//
// __VERSION__ is stamped with the commit sha by the deploy workflow, so
// every deploy installs a coherent snapshot of the whole shell — no
// mixed-version module graphs after an update. The app shows a "new
// version" chip when a fresh worker is waiting; activation happens on tap.
//
// Data (data/*.json) and the GitHub API are NEVER intercepted: the store
// owns data freshness and offline fallback (localStorage mirror), and API
// calls must always hit the network.

const VERSION = '__VERSION__';
const CACHE = `garden-shell-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/styles.css',
  './js/app.js',
  './js/router.js',
  './js/store.js',
  './js/github.js',
  './js/settings.js',
  './js/theme.js',
  './js/ui.js',
  './js/views/today.js',
  './js/views/care.js',
  './js/views/plant.js',
  './js/views/plant-form.js',
  './js/views/settings-view.js',
  './js/views/encyclopedia.js',
  './js/views/calendar.js',
  './js/views/map.js',
  './js/views/map3d.js',
  './js/views/health.js',
  './js/slug.js',
  './js/photos.js',
  './js/components/sync-status.js',
  './js/components/warning-list.js',
  './js/components/event-dialog.js',
  './js/components/plant-row.js',
  './js/components/care-edit-sheet.js',
  './js/components/author-gate.js',
  './shared/effective-care.js',
  './shared/dates.js',
  './shared/season.js',
  './shared/schedule.js',
  './shared/warnings.js',
  './shared/validate.js',
  './shared/markdown.js',
  './shared/calendar.js',
  './shared/pot.js',
  './shared/ops.js',
  './img/icons/favicon.svg',
  './img/icons/icon-192.png',
  './img/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept the GitHub API or the data files (store owns those).
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.json') && url.pathname.includes('/data/')) return;

  // Navigations always land on the cached shell (hash router does the rest).
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((hit) => hit ?? fetch(request)),
    );
    return;
  }

  // Shell & assets: cache-first, runtime-fill for anything not precached
  // (plant art). Runtime entries die with the next version's activate.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
