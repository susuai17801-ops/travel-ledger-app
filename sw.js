// 應用殼層快取：離線也能開 App。改了任何檔案就把 VERSION 加一，舊快取會被清掉。
const VERSION = 'v5';
const CACHE = 'travel-ledger-' + VERSION;
const NETWORK_TIMEOUT_MS = 3000; // 訊號差時最多等 3 秒，再用手機上的快取
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
  // 網路優先、逾時或失敗才用快取：線上時永遠拿到一致的最新版（避免 index.html 新、app.js 舊），離線仍可開
  e.respondWith(
    new Promise(resolve => {
      const fromCache = () => caches.match(req, { ignoreSearch: true }).then(hit => hit || Response.error());
      const timer = setTimeout(() => fromCache().then(resolve), NETWORK_TIMEOUT_MS);
      fetch(req).then(res => {
        clearTimeout(timer);
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          resolve(res);
        } else {
          fromCache().then(hit => resolve(hit.ok ? hit : res));
        }
      }).catch(() => { clearTimeout(timer); fromCache().then(resolve); });
    })
  );
});
