"use strict";

const VERSION = "cinaro-v2.2.0";
const SHELL_CACHE = `${VERSION}-shell`;
const IMAGE_CACHE = `${VERSION}-images`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./data.js",
  "./firebase.js",
  "./app.js",
  "./manifest.webmanifest",
  "./offline.html",
  "./assets/icons/favicon-32.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/images/cinaro-hero.webp",
  "./assets/images/og-image.jpg",
  "./assets/images/poster-placeholder.webp",
  "./assets/subtitles/demo-ar.vtt"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![SHELL_CACHE, IMAGE_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isVideo = request.destination === "video" || /\.(?:mp4|m3u8|webm)(?:$|\?)/i.test(url.pathname);
  if (isVideo) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (request.destination === "image") {
    event.respondWith(staleWhileRevalidateImage(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return (await caches.match(request)) || (await caches.match("./index.html")) || caches.match("./offline.html");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function staleWhileRevalidateImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok || response.type === "opaque") {
        await cache.put(request, response.clone());
        trimCache(IMAGE_CACHE, 80);
      }
      return response;
    })
    .catch(() => null);

  return cached || (await network) || caches.match("./assets/images/poster-placeholder.webp");
}

async function trimCache(cacheName, maximumItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  while (keys.length > maximumItems) {
    await cache.delete(keys.shift());
  }
}
