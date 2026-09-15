const CACHE = "cinaro-admin-v1";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./firebase.js",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/admin-hero.svg",
  "../web/assets/icons/icon-192.png",
  "../web/assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    return response;
  }).catch(() => caches.match("./index.html"))));
});
