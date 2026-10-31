// 應用殼層快取：離線也能開 App。改了任何檔案就把 VERSION 加一，舊快取會被清掉。
const VERSION = 'v3';
const CACHE = 'travel-ledger-' + VERSION;
const SHELL = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/sync.js', './js/fx.js', './js/parse.js', './js/stats.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // 後端與匯率 API 一律走網路
  // 先給快取、背景更新（stale-while-revalidate）
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const net = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
