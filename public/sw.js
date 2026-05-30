// sw.js — Nardeen Caffe v8.3 Service Worker (network-first)
const CACHE = "nardeen-v8-3";
const OFFLINE_ASSETS = ["/", "/index.html", "/manifest.json"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE_ASSETS))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("supabase.co")) return;
  e.respondWith(fetch(e.request).then((res) => { if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return res; }).catch(() => caches.match(e.request).then((c) => c || caches.match("/index.html"))));
});
