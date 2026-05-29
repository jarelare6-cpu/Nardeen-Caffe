// sw.js — Nardeen Caffe v6 Service Worker
// يعمل offline ويخزن الموارد الأساسية
const CACHE = "nardeen-v6";
const OFFLINE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(OFFLINE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Skip non-GET requests
  if (e.request.method !== "GET") return;
  // Skip Supabase API calls — يجب أن تكون fresh دائماً
  if (e.request.url.includes("supabase.co")) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      });
      return cached || net;
    })
  );
});
