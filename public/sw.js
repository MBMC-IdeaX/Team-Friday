// Public pages are cached by URL; never substitute the map for another screen.
const VERSION = "hg-v1";
const SHELL = `${VERSION}-shell-pages-v2`;
const DATA = `${VERSION}-data`;
const OFFLINE_PAGES = ["/", "/sos", "/guardians", "/rights", "/help", "/login"];
const PRECACHE = [...OFFLINE_PAGES, "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/maplibre-gl-worker.mjs", "/maplibre-gl-shared.mjs"];

// Includes chunk references in Next's inline component payload, not just script tags.
function staticAssets(text, base) {
  const assets = new Set();
  const chunks = text.match(/(?:\/?_next\/)?static\/(?:chunks|css|media)\/[a-zA-Z0-9_./%-]+/g) ?? [];
  for (const chunk of chunks) {
    if (!/\.(?:js|mjs|css|woff2?|ttf|otf|png|svg|jpe?g|webp|ico)$/.test(chunk)) continue;
    assets.add(new URL(chunk.startsWith("/_next/") ? chunk : `/_next/${chunk.replace(/^_next\//, "")}`, self.location.origin).href);
  }
  if (new URL(base).pathname.endsWith(".css")) for (const match of text.matchAll(/url\(["']?([^\s"')]+)["']?\)/g)) {
    const url = new URL(match[1], base);
    if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) assets.add(url.href);
  }
  return [...assets];
}

async function prepareOfflinePages() {
  const cache = await caches.open(SHELL);
  const pending = PRECACHE.map(path => new URL(path, self.location.origin).href);
  const visited = new Set();
  while (pending.length) {
    const url = pending.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    const response = await fetch(url, { cache: "reload", credentials: "omit" });
    if (!response.ok || response.redirected) throw new Error("Offline preparation failed");
    const type = response.headers.get("Content-Type") ?? "";
    if (/text\/html|javascript|text\/css/.test(type)) {
      pending.push(...staticAssets(await response.clone().text(), url));
    }
    await cache.put(url, response);
  }
}

self.addEventListener("install", e => {
  e.waitUntil(prepareOfflinePages().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k === `${VERSION}-shell`).map((k) => caches.delete(k))))
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
  } else if (url.pathname.startsWith("/_next/static/") || (PRECACHE.includes(url.pathname) && !OFFLINE_PAGES.includes(url.pathname))) {
    e.respondWith(cacheFirst(request));
  }
});

function unavailableOffline() {
  return new Response(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HerGuardian · Offline</title><body style="background:#111;color:white;font:18px system-ui;padding:24px"><h1>This page needs internet</h1><p>Reconnect to open this page. Your saved information has not been deleted.</p><p><a style="color:#75d5df" href="/">Map</a> · <a style="color:#75d5df" href="/guardians">Guardians</a> · <a style="color:#75d5df" href="/rights">Rights</a> · <a style="color:#75d5df" href="/help">Help</a> · <a style="color:#75d5df" href="/sos">SOS</a></p></body></html>`, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL);
  const url = new URL(request.url);
  const path = url.pathname;
  const hit = OFFLINE_PAGES.includes(path) ? await cache.match(new URL(path, self.location.origin).href) : null;
  if (self.navigator?.onLine === false) return hit ?? unavailableOffline();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const fresh = await fetch(request, { signal: controller.signal });
    // Only public page HTML belongs here; session links and API/RSC data do not.
    if (OFFLINE_PAGES.includes(path) && fresh.ok && !fresh.redirected && (fresh.headers.get("Content-Type") ?? "").includes("text/html")) {
      await cache.put(new URL(path, self.location.origin).href, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    return hit ?? unavailableOffline();
  } finally { clearTimeout(timeout); }
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
