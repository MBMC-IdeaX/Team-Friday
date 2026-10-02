// Offline shell. Precaches the app, serves the safety grid stale-while-revalidate,
// leaves basemap tiles alone. ponytail: no workbox — two strategies and a push
// handler is the whole requirement.
//
// Bump VERSION on deploy: hashed /_next/static assets are cached forever, so an
// old HTML shell must not be paired with a new asset set.

const VERSION = "hg-v1";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

const PRECACHE = ["/", "/manifest.webmanifest", "/icon.svg", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // cross-origin = OSM raster tiles. Not cached: opaque responses are large and
  // OSM's tile policy discourages bulk offline prefetch. Map greys out, not breaks.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    e.respondWith(networkFirstShell(request));
  } else if (url.pathname === "/api/cells") {
    e.respondWith(staleWhileRevalidate(request));
  } else if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(cacheFirst(request));
  }
});

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL);
  try {
    const fresh = await fetch(request);
    // cached under "/" so any route falls back to the same shell offline
    cache.put("/", fresh.clone());
    return fresh;
  } catch {
    return (await cache.match("/")) ?? Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(request);
  const revalidate = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) return hit;
  // no cache and offline: 503 with no `cells` key, so the caller falls back
  return (await revalidate) ?? new Response('{"error":"offline"}', { status: 503 });
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

// S.6 fills this in; the handler is here now so adding push is an edit, not a rewrite.
self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title ?? "SOS — someone needs help", {
      body: data.body ?? "Tap to open live tracking.",
      tag: data.sessionId ?? "herguardian-sos",
      data,
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const sessionId = e.notification.data?.sessionId;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((found) => {
      for (const c of found) {
        if (c.url.includes(sessionId)) return c.focus();
      }
      return self.clients.openWindow(sessionId ? `/guard/${sessionId}` : "/");
    }),
  );
});