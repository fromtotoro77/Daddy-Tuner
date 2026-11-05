// 저장해 둔 파일(manifest 등)을 바꿨으면 이름 끝을 바꿔야 휴대폰에 새 파일이 간다
const CACHE_NAME = 'daddy-tuner-v1.0.2-2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './v1.0.2/index.html',
  './v1.0.2/app.css',
  './v1.0.2/app.js',
  './v1.0.2/visualizer.js',
  './v1.0.2/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(error => {
        console.error('Cache addAll failed:', error);
      });
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
      })
    ])
  );
});

self.addEventListener('fetch', (e) => {
  // 화면(HTML)은 인터넷 먼저: 저장된 옛 index.html 이 옛 버전 폴더로 보내는 일을 막는다.
  // 인터넷이 안 되면 저장본을 쓴다.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
