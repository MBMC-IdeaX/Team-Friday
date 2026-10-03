import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const from = { lat: 27.7, lng: 85.3 }, to = { lat: 27.71, lng: 85.31 };
const safety = { source: 'db', cells: [{ id: 1, ...from, crimeRisk: .2, reportRisk: .1, lighting: .7, crowd: .6 }] };
const routes = { routes: [{ id: 0, duration: 100, distance: 500, safety: 70, coords: [[85.3, 27.7], [85.305, 27.705], [85.31, 27.71]] }], shortestId: 0, safestId: 0, hour: 12 };
const plain = value => JSON.parse(JSON.stringify(value));

// Execute the component's actual hooks, cache, formula and overlay binding.
// Only the DOM, geolocation device and MapLibre renderer are test doubles.
function mounted({ online = false, workerWorks = true, rejectWrite = () => false } = {}) {
  const slots = [], pending = [], modules = new Map(), entries = new Map(), listeners = new Map(), requests = [];
  const maps = [];
  let cursor = 0, dirty = true, tree, Component, gps, timedOut;
  const same = (a, b) => a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => {
        const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, fn };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++; const previous = slots[i];
      if (!previous || !same(previous.deps, deps)) pending.push(() => {
        previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  class FakeMap {
    sources = new Map(); layers = new Map(); events = new Map(); rendered = true;
    constructor(options) { maps.push(this); this.options = options; }
    on(name, fn) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(fn); }
    off(name, fn) { this.events.get(name)?.delete(fn); }
    emit(name, event = {}) { for (const fn of [...(this.events.get(name) ?? [])]) fn(event); }
    addControl() {} resize() {} jumpTo() {} remove() {}
    fitBounds(bounds) { this.bounds = bounds; }
    addSource(id, options) {
      const source = { data: options.data, loaded: false, updates: [], setData(data) {
        this.data = data; this.updates.push(data); this.loaded = false;
        return workerWorks ? Promise.resolve().then(() => { this.loaded = true; }) : new Promise(() => {});
      } };
      this.sources.set(id, source);
    }
    getSource(id) { return this.sources.get(id); }
    addLayer(layer) { this.layers.set(layer.id, layer); this.emit('styledata'); }
    getLayer(id) { return this.layers.get(id); }
    isSourceLoaded(id) { return this.sources.get(id)?.loaded ?? false; }
    queryRenderedFeatures() { return this.rendered ? this.sources.get('cells')?.data.features ?? [] : []; }
    loadStyle() { this.emit('style.load'); }
    replaceStyle() { this.emit('styledataloading'); this.sources.clear(); this.layers.clear(); this.loadStyle(); }
  }
  class Marker { setLngLat(point) { this.point = point; return this; } addTo() { return this; } remove() {} }
  const navigator = { onLine: online };
  const caches = { async open() { return {
    async match(key) { return entries.get(key)?.clone(); },
    async put(key, value) { if (rejectWrite(key)) throw new Error('storage unavailable'); entries.set(key, value.clone()); },
  }; } };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const require = name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === 'maplibre-gl') return { Map: FakeMap, Marker, AttributionControl: class {}, config: {} };
      if (name.endsWith('.css')) return {};
      if (name === 'next/navigation') return { useRouter: () => ({ push() {} }) };
      if (name === '@/lib/location') return {
        watchDeviceLocation(fn) { gps = fn; return () => {}; },
        routingOrigin: load('src/lib/location.ts').routingOrigin,
      };
      if (name === '@/lib/offline') return { activeSessionId: () => null };
      if (name === '@/lib/voice') return { voiceSupported: () => false };
      if (name.startsWith('@/components/')) return { default: name };
      if (name.startsWith('@/lib/')) return load(`src/lib/${name.slice('@/lib/'.length)}.ts`);
      if (name.startsWith('./')) return load(`src/lib/${name.slice(2)}.ts`);
      throw new Error(`Unexpected import ${name}`);
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, require, navigator, caches, Response, AbortController, AbortSignal,
      process: { env: { NODE_ENV: 'production' } }, ResizeObserver: class { observe() {} disconnect() {} },
      setInterval() { return 1; }, clearInterval() {},
      setTimeout(fn, ms) { if (ms === 10_000) { timedOut = fn; return 0; } return setTimeout(fn, ms); }, clearTimeout,
      addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
      fetch: async url => {
        requests.push(url); if (!navigator.onLine) throw new Error('offline');
        return Response.json(url.startsWith('/api/routes') ? routes : url.startsWith('/api/score') ? { score: 70 } : safety);
      },
    });
    return exports;
  }
  function walk(node, visit) {
    if (Array.isArray(node)) return node.forEach(item => walk(item, visit));
    if (!node || typeof node !== 'object') return;
    visit(node); walk(node.props?.children, visit);
  }
  Component = load('src/components/map-view.tsx').default;
  return {
    cache: load('src/lib/map-cache.ts'), entries, requests,
    get map() { return maps[0]; }, get tree() { return tree; },
    async flush() {
      for (let i = 0; i < 30; i++) {
        if (dirty) {
          dirty = false; cursor = 0; tree = Component();
          walk(tree, node => { if (node.props?.ref) node.props.ref.current ??= {}; });
          while (pending.length) pending.shift()();
        }
        await new Promise(resolve => setImmediate(resolve));
      }
    },
    nodes(predicate) { const found = []; walk(tree, node => { if (predicate(node)) found.push(node); }); return found; },
    text() { return JSON.stringify(tree, (key, value) => ['ref', 'onClick', 'onPick'].includes(key) ? undefined : value); },
    locate(point) { gps({ ...point, accuracy: 6, at: Date.now() }); },
    network(value) { navigator.onLine = value; for (const fn of [...(listeners.get(value ? 'online' : 'offline') ?? [])]) fn(); },
    timeout() { timedOut(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

for (const styleFirst of [false, true]) test(`offline MapView feeds valid cached cells into real overlay binding (${styleFirst ? 'style' : 'cache'} first) and restores replaced sources`, async t => {
  const app = mounted(); t.after(() => app.dispose());
  await app.cache.saveSafetyCache(safety);
  if (styleFirst) {
    // Delay cache completion until the MapLibre style event has fired.
    const original = app.cache.readSafetyCache; let release;
    app.cache.readSafetyCache = () => new Promise(resolve => { release = () => original().then(resolve); });
    await app.flush(); app.map.loadStyle(); release();
  } else { await app.flush(); app.map.loadStyle(); }
  await app.flush(); app.map.emit('render'); await app.flush();
  const expected = plain(app.map.getSource('cells').data);
  assert.equal(expected.features.length, 1);
  assert.deepEqual(expected.features[0].geometry.coordinates, [from.lng, from.lat]);
  assert.ok(Number.isFinite(expected.features[0].properties.score));
  assert.equal(app.map.getLayer('cells').type, 'circle');
  assert.match(app.text(), /Saved safety data/);
  assert.equal(app.nodes(n => n.props?.['data-hg-overlay-stage'])[0].props['data-hg-overlay-stage'], 'rendered');
  app.map.replaceStyle(); await app.flush(); app.map.emit('render'); await app.flush();
  assert.deepEqual(plain(app.map.getSource('cells').data), expected);
  assert.equal(app.map.getLayer('cells').type, 'circle');
  assert.deepEqual(app.requests, []);
});

test('cached metadata with empty cells never claims usable saved safety', async t => {
  const app = mounted(); t.after(() => app.dispose());
  app.entries.set('/__offline/safety', Response.json({ savedAt: Date.now(), value: { ...safety, cells: [] } }));
  await app.flush(); app.map.loadStyle(); await app.flush();
  assert.doesNotMatch(app.text(), /Saved safety data/);
  assert.match(app.text(), /No saved safety dataset.*Synthetic demo safety data/);
});

for (const gps of [null, { lat: 27.7003, lng: 85.3002 }]) test(`reopen offline journey restores actual route sources with ${gps ? 'drifting' : 'unavailable'} GPS and no API calls`, async t => {
  const app = mounted({ online: true }); t.after(() => app.dispose());
  await app.cache.saveSafetyCache(safety);
  const generated = await app.cache.loadRoute(from, to, new AbortController().signal);
  assert.equal(generated.persisted, true);
  const stored = await app.entries.get('/__offline/last-route').clone().json();
  assert.deepEqual(stored.value, { from, to, routes });
  app.network(false); app.requests.length = 0;
  await app.flush(); app.map.loadStyle();
  if (gps) app.locate(gps);
  await app.flush();
  const reopen = app.nodes(n => n.type === 'button' && n.props.children === 'Reopen last saved journey')[0];
  await reopen.props.onClick(); await app.flush();
  for (const id of ['shortest', 'safest']) {
    assert.deepEqual(plain(app.map.getSource(id).data.geometry.coordinates), routes.routes[0].coords);
    assert.equal(app.map.getLayer(id).type, 'line');
  }
  assert.match(app.text(), /Original start: 27.7, 85.3; not your live GPS start/);
  if (gps) { app.locate({ lat: 27.701, lng: 85.301 }); await app.flush(); }
  app.map.replaceStyle(); await app.flush();
  assert.deepEqual(plain(app.map.getSource('safest').data.geometry.coordinates), routes.routes[0].coords);
  assert.deepEqual(app.requests, []);
});

test('online component journey stays visible as saved geometry after going offline with GPS drift', async t => {
  const app = mounted({ online: true }); t.after(() => app.dispose());
  await app.flush(); app.map.loadStyle(); app.locate(from); await app.flush();
  app.map.emit('click', { lngLat: to }); await app.flush();
  assert.deepEqual(plain(app.map.getSource('safest').data.geometry.coordinates), routes.routes[0].coords);
  assert.equal(app.requests.filter(url => url.startsWith('/api/routes')).length, 1);
  app.network(false); app.locate({ lat: from.lat + .0003, lng: from.lng + .0003 }); await app.flush();
  assert.deepEqual(plain(app.map.getSource('safest').data.geometry.coordinates), routes.routes[0].coords);
  assert.match(app.text(), /Saved journey.*not your live GPS start/);
  assert.equal(app.requests.filter(url => url.startsWith('/api/routes')).length, 1);
});

test('pending GeoJSON worker does not equate valid cache/source data with rendered circles', async t => {
  const app = mounted({ workerWorks: false }); t.after(() => app.dispose());
  await app.cache.saveSafetyCache(safety); await app.flush(); app.map.loadStyle(); await app.flush();
  assert.equal(app.map.getSource('cells').data.features.length, 1);
  app.timeout(); await app.flush();
  assert.match(app.text(), /Map overlays could not render/);
  assert.equal(app.nodes(n => n.props?.['data-hg-overlay-stage'])[0].props['data-hg-overlay-stage'], 'failed');
});

test('offscreen cells report source-ready rather than falsely claiming rendered dots', async t => {
  const app = mounted(); t.after(() => app.dispose());
  await app.cache.saveSafetyCache(safety); await app.flush(); app.map.rendered = false; app.map.loadStyle(); await app.flush();
  assert.equal(app.nodes(n => n.props?.['data-hg-overlay-stage'])[0].props['data-hg-overlay-stage'], 'source-ready');
});

test('historical restoration uses exact persisted endpoints before live-routing coordinate rounding', async t => {
  const app = mounted(); t.after(() => app.dispose());
  const original = { lat: 27.700045, lng: 85.300045 };
  await app.cache.saveJourney(original, to, routes);
  await app.flush(); app.map.loadStyle(); await app.flush();
  await app.nodes(n => n.type === 'button' && n.props.children === 'Reopen last saved journey')[0].props.onClick();
  await app.flush();
  assert.deepEqual(plain(app.map.getSource('safest').data.geometry.coordinates), routes.routes[0].coords);
  assert.match(app.text(), /Original start: 27.700045, 85.300045/);
  assert.deepEqual(app.requests, []);
});

test('MapLibre source error stays visible even when other overlays continue rendering', async t => {
  const app = mounted(); t.after(() => app.dispose());
  await app.cache.saveSafetyCache(safety); await app.flush(); app.map.loadStyle(); await app.flush();
  app.map.emit('error', { sourceId: 'safest', error: { message: 'worker processing failure' } });
  app.map.emit('render'); await app.flush();
  assert.match(app.text(), /Map overlays could not render/);
  app.map.replaceStyle(); await app.flush();
  assert.equal(app.nodes(n => n.props?.['data-hg-overlay-stage'])[0].props['data-hg-overlay-stage'], 'rendered');
});

test('reopen without saved geometry offers an online recovery rather than fabricating a route', async t => {
  const app = mounted(); t.after(() => app.dispose());
  await app.flush(); app.map.loadStyle(); await app.flush();
  await app.nodes(n => n.type === 'button' && n.props.children === 'Reopen last saved journey')[0].props.onClick();
  await app.flush();
  assert.match(app.text(), /No saved journey is available. Generate a route online first/);
  assert.equal(app.map.getSource('safest').data.geometry.coordinates.length, 0);
  assert.deepEqual(app.requests, []);
});

test('complete journey survives a failed separate endpoint-cache write, while failed journey storage is disclosed', async t => {
  const app = mounted({ online: true, rejectWrite: key => key.startsWith('/__offline/routes?') }); t.after(() => app.dispose());
  assert.equal((await app.cache.loadRoute(from, to, new AbortController().signal)).persisted, true);
  assert.deepEqual(plain((await app.cache.readLastJourney()).value), routes);
  const blocked = mounted({ online: true, rejectWrite: key => key === '/__offline/last-route' }); t.after(() => blocked.dispose());
  await blocked.flush(); blocked.map.loadStyle(); blocked.locate(from); await blocked.flush();
  blocked.map.emit('click', { lngLat: to }); await blocked.flush();
  assert.match(blocked.text(), /could not be saved on this device/);
  assert.deepEqual(plain(blocked.map.getSource('safest').data.geometry.coordinates), routes.routes[0].coords);
});
