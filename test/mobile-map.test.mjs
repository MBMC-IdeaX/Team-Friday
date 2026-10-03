import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, globals) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Response, AbortSignal, AbortController, setTimeout, clearTimeout,
    require: name => {
      if (name === './network') return load('src/lib/network.ts', globals);
      throw new Error(`Unexpected import ${name}`);
    }, ...globals });
  return exports;
}
function device() {
  let success, failure, options, expired, cleared;
  const location = load('src/lib/location.ts', {
    window: { isSecureContext: true },
    navigator: { geolocation: {
      watchPosition(ok, error, opts) { success = ok; failure = error; options = opts; return 7; },
      clearWatch(id) { cleared = id; },
    } },
    setInterval(fn) { expired = fn; return 1; }, clearInterval() {},
  });
  return { location, good(lat = 27.74, lng = 85.36, accuracy = 10, timestamp = Date.now()) {
    success({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp });
  }, fail(code) { failure({ code }); }, get options() { return options; },
  get cleared() { return cleared; }, expire() { expired(); } };
}
test('GPS replaces unknown state and supplies actual routing and SOS coordinates; cleanup ignores late callbacks', () => {
  const d = device(); const positions = [], errors = [];
  assert.equal(d.location.routingOrigin(null, null), null);
  assert.equal(d.location.sosSeed('id').lat, null);
  const stop = d.location.watchDeviceLocation(p => positions.push(p), e => errors.push(e));
  d.good();
  const fix = d.location.currentDeviceLocation();
  assert.equal(fix.lat, 27.74); assert.equal(fix.lng, 85.36);
  assert.equal(d.location.routingOrigin(null, fix).lat, 27.74);
  assert.equal(d.location.sosSeed('id').lng, 85.36);
  assert.equal(d.options.maximumAge, 0); assert.equal(d.options.enableHighAccuracy, true);
  d.good(27.75, 85.37); assert.equal(d.location.sosSeed('id').lat, 27.75);
  assert.equal(d.location.routingOrigin({ lat: 28, lng: 86 }, fix).lat, 28);
  stop(); d.good(29); assert.equal(positions.length, 2); assert.equal(d.cleared, 7);
});
test('denied, timed out, inaccurate and stale GPS yield unknown SOS location, never demo coordinates', () => {
  const d = device(); const errors = [];
  d.location.watchDeviceLocation(() => {}, e => errors.push(e));
  for (const code of [1, 2, 3]) {
    d.good(); d.fail(code); assert.equal(d.location.sosSeed('id').lat, null);
  }
  d.good(27.74, 85.36, 151); assert.equal(d.location.currentDeviceLocation(), null);
  d.good(27.74, 85.36, 10, Date.now() - 31_000); assert.equal(d.location.sosSeed('id').lng, null);
  assert.equal(errors.length, 5);
  const noApi = load('src/lib/location.ts', { window: { isSecureContext: false }, navigator: {} });
  noApi.watchDeviceLocation(() => assert.fail(), message => assert.match(message, /HTTPS/));
  assert.equal(noApi.sosSeed('id').lat, null);
});
function storage() {
  const entries = new Map();
  const cache = { async match(key) { return entries.get(key)?.clone(); },
    async put(key, value) { entries.set(key, value.clone()); } };
  return { entries, cache, caches: { async open() { return cache; } } };
}
const safety = { source: 'db', cells: [{ id: 1, lat: 27.7, lng: 85.3, crimeRisk: .2, reportRisk: .1, lighting: .7, crowd: .6 }] };
const routes = { routes: [{ id: 0, duration: 100, distance: 500, safety: 70, coords: [[85.3, 27.7], [85.4, 27.8]] }], shortestId: 0, safestId: 0, hour: 12 };
const from = { lat: 27.7, lng: 85.3 }, to = { lat: 27.8, lng: 85.4 };
test('offline safety copy survives invalid, empty and demo replacements', async () => {
  const store = storage();
  const api = load('src/lib/map-cache.ts', { caches: store.caches });
  assert.equal(await api.saveSafetyCache(safety), true);
  for (const value of [null, { ...safety, cells: [] }, { ...safety, cells: [{ ...safety.cells[0], crimeRisk: 2 }] }, { ...safety, source: 'fake' }]) {
    assert.equal(await api.saveSafetyCache(value), false);
    assert.equal((await api.readSafetyCache()).value.source, 'db');
    assert.equal((await api.readSafetyCache()).value.cells[0].lat, 27.7);
  }
});
test('offline route reuse requires the exact endpoints; missing and expired routes are truthful', async () => {
  const store = storage(); const navigator = { onLine: true }; let calls = 0;
  const api = load('src/lib/map-cache.ts', { caches: store.caches, navigator,
    fetch: async () => { calls++; return Response.json(routes); } });
  const signal = new AbortController().signal;
  assert.equal((await api.loadRoute(from, to, signal)).cached, false);
  navigator.onLine = false;
  assert.equal((await api.loadRoute(from, to, signal)).cached, true); assert.equal(calls, 1);
  assert.equal((await api.lastRouteDestination(from)).lat, to.lat);
  await assert.rejects(api.loadRoute({ ...from, lat: 27.71 }, to, signal), /Offline: no saved route/);
  const key = api.routeCacheKey(from, to);
  await store.cache.put(key, Response.json({ value: routes, savedAt: Date.now() - 25 * 60 * 60 * 1000 }));
  assert.equal(await api.readRouteCache(key), null);
  // The complete last journey is independent of the per-endpoint lookup entry.
  assert.equal((await api.readLastJourney()).to.lat, to.lat);
  await assert.rejects(api.loadRoute(from, to, signal), /Offline: no saved route/);
});
test('network failure falls back to saved route; invalid response does not poison route cache', async () => {
  const store = storage(); let fail = false;
  const api = load('src/lib/map-cache.ts', { caches: store.caches, navigator: { onLine: true },
    fetch: async () => { if (fail) throw new Error('network'); return Response.json({ routes: [] }); } });
  const key = api.routeCacheKey(from, to); await api.saveRouteCache(key, routes);
  assert.equal((await api.loadRoute(from, to, new AbortController().signal)).cached, true);
  fail = true; assert.equal((await api.loadRoute(from, to, new AbortController().signal)).value.routes[0].distance, 500);
});
test('service worker preserves valid factors across empty, corrupt and failed refreshes', async () => {
  const store = storage(); let next = safety;
  const context = vm.createContext({ self: { addEventListener() {} }, caches: store.caches, Response, Headers,
    AbortController, setTimeout, clearTimeout,
    fetch: async () => { if (next instanceof Error) throw next; return Response.json(next); } });
  vm.runInContext(fs.readFileSync('public/sw.js', 'utf8'), context);
  const request = 'https://example.test/api/cells';
  assert.equal((await context.safetyData(request)).headers.get('X-HG-Safety-Cache'), null);
  for (next of [{ ...safety, cells: [] }, new Error('offline'), { ...safety, source: 'fake' }]) {
    const response = await context.safetyData(request);
    assert.equal(response.headers.get('X-HG-Safety-Cache'), '1');
    assert.equal((await response.json()).source, 'db');
  }
  store.entries.clear(); next = new Error('offline');
  assert.equal((await context.safetyData(request)).status, 503);
});

test('stationary GPS is refreshed after expiry instead of leaving the location unavailable indefinitely', () => {
  let now = 1_000_000, accept, tick, requests = 0;
  class Clock extends Date { static now() { return now; } }
  const position = () => ({ coords: { latitude: 27.74, longitude: 85.36, accuracy: 10 }, timestamp: now });
  const api = load('src/lib/location.ts', { Date: Clock, window: { isSecureContext: true }, navigator: { geolocation: {
    watchPosition(fn) { accept = fn; return 1; }, clearWatch() {},
    getCurrentPosition(fn) { requests++; fn(position()); },
  } }, setInterval(fn) { tick = fn; return 1; }, clearInterval() {} });
  const fixes = []; api.watchDeviceLocation(fix => fixes.push(fix), () => {});
  accept(position()); now += 31_000; tick();
  assert.equal(requests, 1); assert.equal(fixes.length, 2);
  assert.equal(api.currentDeviceLocation().at, now);
});

test('request deadline and caller cancellation stop the request without leaving pending work', async () => {
  const network = load('src/lib/network.ts', {
    fetch: async (_, init) => new Promise((resolve, reject) => {
      if (init.signal.aborted) reject(new Error('aborted'));
      else init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  await assert.rejects(network.fetchJson('/test', {}, 5), /aborted/);
  const controller = new AbortController();
  const request = network.fetchJson('/test', { signal: controller.signal });
  controller.abort(); await assert.rejects(request, /aborted/);
});

test('saved journey reopens original endpoints despite GPS drift or unavailable GPS, and expires honestly', async () => {
  const store = storage(); const navigator = { onLine: true };
  const api = load('src/lib/map-cache.ts', { caches: store.caches, navigator, fetch: async () => Response.json(routes) });
  await api.loadRoute(from, to, new AbortController().signal); navigator.onLine = false;
  const journey = await api.readLastJourney();
  assert.equal(journey.from.lat, from.lat); assert.equal(journey.to.lng, to.lng);
  assert.equal(journey.value.routes[0].coords.length, 2);
  assert.equal(await api.lastRouteDestination({ ...from, lat: from.lat + .0002 }), null);
  assert.equal((await api.readLastJourney()).value.routes[0].distance, 500);
  await store.cache.put('/__offline/last-route', Response.json({ value: { from, to, routes }, savedAt: Date.now() - 25 * 60 * 60 * 1000 }));
  assert.equal(await api.readLastJourney(), null);
});

test('previous pointer-format journey remains readable without deleting or rewriting saved data', async () => {
  const store = storage();
  const api = load('src/lib/map-cache.ts', { caches: store.caches });
  await api.saveRouteCache(api.routeCacheKey(from, to), routes);
  await store.cache.put('/__offline/last-route', Response.json({ from, to }));
  assert.equal((await api.readLastJourney()).value.routes[0].coords.length, 2);
  assert.deepEqual(await (await store.cache.match('/__offline/last-route')).json(), { from, to });
});
