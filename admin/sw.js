const CACHE = "cinaro-admin-v2.7.0";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./supabase.js",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/admin-hero.svg",
  "./assets/icons/favicon-32.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  const freshAsset = request.mode === "navigate"
    || ["script", "style", "worker"].includes(request.destination)
    || /\.(?:js|css|json|webmanifest)(?:$|\?)/i.test(url.pathname + url.search);

  if (freshAsset) {
    event.respondWith(fetch(request, { cache: "no-store" }).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html"))));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    return response;
  })));
});
