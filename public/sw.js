// Public pages are cached by URL; never substitute the map for another screen.
const VERSION = "hg-v1";
// A new worker prepares its own assets before replacing the previous worker.
const SHELL = `${VERSION}-shell-pages-v4`;
const DATA = `${VERSION}-data`;
const TILES = `${VERSION}-viewed-tiles`;
const TILE_META = `${VERSION}-viewed-tile-metadata`;
const MAX_TILES = 200;
let tileWrites = Promise.resolve();
const OFFLINE_PAGES = ["/", "/sos", "/guardians", "/rights", "/help", "/login"];
const PRECACHE = [...OFFLINE_PAGES, "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/maplibre-gl-worker.mjs", "/maplibre-gl-shared.mjs"];

function usableAsset(response, url) {
  if (!response.ok || response.redirected) return false;
  const path = new URL(url, self.location.origin).pathname;
  const type = response.headers.get("Content-Type") ?? "";
  if (/\.m?js$/.test(path)) return /(?:application|text)\/(?:javascript|ecmascript)/i.test(type);
  if (/\.css$/.test(path)) return /text\/css/i.test(type);
  if (OFFLINE_PAGES.includes(path)) return /text\/html/i.test(type);
  return true;
}

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
    if (!usableAsset(response, url)) throw new Error("Offline preparation failed");
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
      .then((keys) => Promise.all(keys.filter((k) => [`${VERSION}-shell`, `${VERSION}-shell-pages-v2`, `${VERSION}-shell-pages-v3`].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Only normal viewport requests are cached. No tile prefetch/download jobs.
  if (url.origin === "https://tile.openstreetmap.org" && /^\/\d+\/\d+\/\d+\.png$/.test(url.pathname) && !url.search) {
    e.respondWith(viewedTile(request));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    e.respondWith(networkFirstShell(request));
  } else if (url.pathname === "/api/cells") {
    e.respondWith(safetyData(request));
  } else if (url.pathname.startsWith("/_next/static/") || (PRECACHE.includes(url.pathname) && !OFFLINE_PAGES.includes(url.pathname))) {
    e.respondWith(cacheFirst(request));
  }
});

async function viewedTile(request) {
  let cache, meta, hit, policy;
  try {
    cache = await caches.open(TILES); meta = await caches.open(TILE_META);
    hit = await cache.match(request);
    if (hit && (!hit.ok || hit.type === "opaque" || !(hit.headers.get("Content-Type") ?? "").includes("image/png"))) hit = null;
    policy = await (await meta.match(request))?.json().catch(() => null);
    if (hit && policy?.expires > Date.now()) return hit;
  } catch { /* cache failures must not prevent normal online map viewing */ }
  try {
    const response = await fetch(request); // Browser HTTP cache handles conditional revalidation.
    if (response.ok && response.type !== "opaque" && (response.headers.get("Content-Type") ?? "").includes("image/png")) {
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      const control = response.headers.get("Cache-Control") ?? "";
      if (bytes.length <= 256 * 1024 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte) && !/no-store/i.test(control)) {
        const maxAge = control.match(/max-age=(\d+)/i)?.[1];
        const date = Date.parse(response.headers.get("Date") ?? "");
        const expiry = Date.parse(response.headers.get("Expires") ?? "");
        const expires = /no-cache/i.test(control) ? 0 : maxAge !== undefined && Number.isFinite(date) ? date + Number(maxAge) * 1000
          : Number.isFinite(expiry) ? expiry : Date.now() + Number(maxAge ?? 7 * 24 * 60 * 60) * 1000;
        tileWrites = tileWrites.catch(() => {}).then(async () => {
          cache ??= await caches.open(TILES); meta ??= await caches.open(TILE_META);
          const keys = await cache.keys();
          const replacing = keys.some(key => key.url === request.url);
          for (const key of keys.slice(0, Math.max(0, keys.length - MAX_TILES + (replacing ? 0 : 1)))) {
            await cache.delete(key); await meta.delete(key);
          }
          await meta.put(request, Response.json({ expires, mustRevalidate: /must-revalidate|no-cache/i.test(control) }));
          await cache.put(request, response.clone());
        });
        await tileWrites.catch(() => {});
      }
    }
    return response;
  } catch {
    if (hit && !policy?.mustRevalidate) return hit;
    return new Response("This map tile is not available offline", { status: 503 });
  }
}

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
  // Asset URLs identify their content; navigation/RSC requests never use this path.
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit && usableAsset(hit, request.url)) return hit;
  const res = await fetch(request);
  if (usableAsset(res, request.url)) await cache.put(request, res.clone()).catch(() => {});
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
