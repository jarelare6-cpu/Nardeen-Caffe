// sw.js — Nardeen Caffe v9 — يعمل أوفلاين بثبات
// • التثبيت: يخزّن الهيكل + يقرأ index.html ويخزّن كل أصوله (js/css/خطوط/أيقونات).
// • الأصول (/assets/* مع بصمة) → cache-first (سريعة وتعمل أوفلاين).
// • التنقّل/index.html → network-first (يلتقط النشر الجديد أونلاين، ويرجع للكاش أوفلاين).
// • يتجاهل الطلبات الخارجية (Supabase / esm.sh) فتذهب للشبكة مباشرةً.
const CACHE = "nardeen-v9";
const SHELL = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll(SHELL); } catch {}
    try {
      const res = await fetch("/index.html", { cache: "no-cache" });
      if (res && res.ok) {
        await cache.put("/index.html", res.clone());
        const html = await res.text();
        const urls = Array.from(
          html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|woff2?|ttf|png|svg|ico|json))"/g)
        ).map((m) => m[1]);
        await Promise.all(urls.map((u) => cache.add(u).catch(() => {})));
      }
    } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // Supabase/esm.sh → الشبكة مباشرةً

  // أصول ثابتة ببصمة → cache-first
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(req).then((c) => c || fetch(req).then((res) => {
        if (res && res.ok) { const cl = res.clone(); caches.open(CACHE).then((x) => x.put(req, cl)); }
        return res;
      }))
    );
    return;
  }

  // التنقّل / صفحات HTML → network-first مع رجوع للكاش
  if (req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html")) {
    e.respondWith(
      fetch(req).then((res) => {
        const cl = res.clone(); caches.open(CACHE).then((x) => x.put("/index.html", cl));
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match("/index.html")))
    );
    return;
  }

  // غير ذلك → cache-first ثم الشبكة
  e.respondWith(
    caches.match(req).then((c) => c || fetch(req).then((res) => {
      if (res && res.ok) { const cl = res.clone(); caches.open(CACHE).then((x) => x.put(req, cl)); }
      return res;
    }).catch(() => caches.match(req)))
  );
});
