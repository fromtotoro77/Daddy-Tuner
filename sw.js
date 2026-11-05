// 루트가 곧 배포본이다. 버전 폴더(v1.0.x)는 보관용 스냅샷일 뿐 여기서 쓰지 않는다.
// 파일을 바꾸면 CACHE_NAME 끝 번호를 올린다.
const CACHE_NAME = 'daddy-tuner-v1.0.4';

const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './visualizer.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch((err) => {
      console.error('캐시 등록 실패:', err);
    })),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
    )),
  ]));
});

// 네트워크 우선, 실패하면 캐시.
// 캐시 우선으로 두면 파일을 고쳐도 예전 화면이 계속 떠서 갱신이 안 된 것처럼 보인다.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((hit) => hit || caches.match('./index.html'))),
  );
});
