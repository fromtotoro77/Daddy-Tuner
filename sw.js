const CACHE_NAME = 'daddy-tuner-v1.0.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './v1.0.0/index.html',
  './v1.0.0/app.css',
  './v1.0.0/app.js',
  './v1.0.0/visualizer.js',
  './v1.0.0/icon-512.png'
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
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
