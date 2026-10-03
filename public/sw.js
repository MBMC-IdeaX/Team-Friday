// Offline shell. Precaches the app, serves valid saved safety data when the network fails,
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
    e.respondWith(safetyData(request));
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

function validSafety(value) {
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  return value && ["db", "fake"].includes(value.source) && Array.isArray(value.cells) && value.cells.length > 0 &&
    value.cells.every(c => c && finite(c.id) && finite(c.lat) && Math.abs(c.lat) <= 90 && finite(c.lng) && Math.abs(c.lng) <= 180 &&
      [c.crimeRisk, c.reportRisk, c.lighting, c.crowd].every(v => finite(v) && v >= 0 && v <= 1));
}
function savedSafetyResponse(hit) {
  const headers = new Headers(hit.headers);
  headers.set("X-HG-Safety-Cache", "1");
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
}
async function safetyData(request) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(request);
  const saved = hit ? await hit.clone().json().catch(() => null) : null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const fresh = await fetch(request, { signal: controller.signal });
    const value = fresh.ok ? await fresh.clone().json().catch(() => null) : null;
    if (!validSafety(value)) throw new Error("invalid safety data");
    if (value.source === "fake" && validSafety(saved) && saved.source === "db") return savedSafetyResponse(hit);
    await cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    return validSafety(saved) ? savedSafetyResponse(hit) : new Response('{"error":"safety data unavailable"}', { status: 503 });
  } finally { clearTimeout(timeout); }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

self.addEventListener("push", (e) => {
  let data;
  if (!e.data) {
    return;
  }
  try { data = e.data.json(); } catch {
    return;
  }
  if (typeof data?.sessionId !== "string" || !SESSION_UUID.test(data.sessionId)) {
    return;
  }
  e.waitUntil(self.registration.showNotification("HerGuardian SOS", {
    body: "Emergency SOS activated. Tap to view the guardian session.",
    tag: data.sessionId,
    data: { sessionId: data.sessionId },
  }).catch(() => {}));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const sessionId = e.notification.data?.sessionId;
  if (typeof sessionId !== "string" || !SESSION_UUID.test(sessionId)) return;
  const target = new URL(`/guard/${sessionId}`, self.location.origin);
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((found) => {
    for (const client of found) {
      const url = new URL(client.url);
      if (url.origin === target.origin && url.pathname === target.pathname) return client.focus();
    }
    return self.clients.openWindow(target.href);
  }).catch(() => {}));
});
