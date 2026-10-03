import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Render actual component hooks; only browser/OS/network boundaries are doubles.
function mounted(file, props, mocks, globals) {
  const slots = [], effects = [], modules = new Map(), timers = new Map();
  let cursor = 0, dirty = true, tree;
  const same = (a, b) => a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => {
        const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
      }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || !same(old.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    },
  };
  const jsx = (type, props) => ({ type, props });
  function load(path) {
    if (modules.has(path)) return modules.get(path);
    const exports = {}; modules.set(path, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, {
      exports, Blob, Response, URL, Error, AbortController,
      addEventListener() {}, removeEventListener() {},
      setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
      setInterval() { return 1; }, clearInterval() {},
      require(name) {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (name in mocks) return mocks[name];
        if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
        throw new Error(`Unexpected import: ${name}`);
      }, ...globals,
    });
    return exports;
  }
  const Component = load(file).default;
  function walk(node, fn) {
    if (Array.isArray(node)) return node.forEach(n => walk(n, fn));
    if (!node || typeof node !== 'object') return;
    fn(node); walk(node.props?.children, fn);
  }
  return {
    load,
    async flush() {
      for (let i = 0; i < 20; i++) {
        if (dirty) { dirty = false; cursor = 0; tree = Component(props); while (effects.length) effects.shift()(); }
        await new Promise(resolve => setImmediate(resolve));
      }
    },
    async search() { for (const [id, timer] of [...timers]) if (timer.ms === 600) { timers.delete(id); await timer.fn(); } },
    nodes(predicate) { const out = []; walk(tree, node => { if (predicate(node)) out.push(node); }); return out; },
    text() { return JSON.stringify(tree); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
test('online place selection persists coordinates and label; offline selection makes no geocoding request', async t => {
  const entries = new Map(), calls = [], picks = [], navigator = { onLine: true };
  const caches = { async open() { return {
    async match(key) { return entries.get(key)?.clone(); },
    async put(key, value) { entries.set(key, value.clone()); },
  }; } };
  const create = () => mounted('src/components/place-search.tsx', { placeholder: 'Destination', onPick: p => picks.push(p) }, {
    '@/lib/network': { async fetchJson(url) { calls.push(url.href); return { response: { ok: true }, data: [{ display_name: 'Thamel, Kathmandu', lat: '27.715', lon: '85.31' }] }; } },
  }, { caches, navigator });
  const online = create(); t.after(() => online.dispose()); await online.flush();
  online.nodes(n => n.type === 'input')[0].props.onChange({ target: { value: 'Thamel' } });
  await online.flush(); await online.search(); await online.flush();
  online.nodes(n => n.type === 'button')[0].props.onClick(); await online.flush();
  const expected = { label: 'Thamel, Kathmandu', lat: 27.715, lng: 85.31 };
  assert.deepEqual(JSON.parse(JSON.stringify(await online.load('src/lib/places-cache.ts').readSavedPlaces())), [expected]);
  assert.equal(calls.length, 1);
  navigator.onLine = false;
  const offline = create(); t.after(() => offline.dispose()); await offline.flush();
  offline.nodes(n => n.type === 'input')[0].props.onFocus(); await offline.flush();
  assert.match(offline.text(), /Saved places on this device/);
  offline.nodes(n => n.type === 'button')[0].props.onClick(); await offline.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(picks.at(-1))), expected);
  assert.equal(calls.length, 1, 'offline cached selection makes no request');
});
test('saved destinations are validated, deduplicated and bounded without changing other app data', async t => {
  const entries = new Map([['unrelated', Response.json({ preserved: true })]]);
  const app = mounted('src/components/place-search.tsx', { placeholder: 'Destination', onPick() {} }, {}, {
    navigator: { onLine: false }, caches: { async open() { return {
      async match(key) { return entries.get(key)?.clone(); }, async put(key, value) { entries.set(key, value.clone()); },
    }; } },
  }); t.after(() => app.dispose());
  const cache = app.load('src/lib/places-cache.ts');
  assert.equal(await cache.savePlace({ label: 'bad', lat: NaN, lng: 85 }), false);
  for (let i = 0; i < 25; i++) await cache.savePlace({ label: `Place ${i}`, lat: 27 + i / 1000, lng: 85 });
  await cache.savePlace({ label: 'Updated', lat: 27.024, lng: 85 });
  const places = await cache.readSavedPlaces(); assert.equal(places.length, 20); assert.equal(places[0].label, 'Updated');
  assert.equal(places.filter(p => p.lat === 27.024).length, 1); assert.ok(entries.has('unrelated'));
});
test('SOS commits before requesting microphone; denial leaves offline SOS active and ending still works without a siren', async t => {
  let commit, persisted = false, microphoneCalls = 0, ended = false, navigation;
  const queued = new Promise(resolve => { commit = () => { persisted = true; resolve(1); }; });
  const id = '11111111-1111-4111-8111-111111111111';
  const app = mounted('src/app/(bare)/sos/page.tsx', {}, {
    'next/navigation': { useRouter: () => ({}) },
    '@/lib/navigation': { navigateTo: path => { navigation = path; } },
    '@/lib/offline': {
      activeSessionId: () => null, newId: () => id, queueRequest: () => queued, setActiveSession() {},
      listGuardians: async () => [], pendingRecordings: async () => [], flushRecordings: () => new Promise(() => {}),
      endSosSession: async value => { assert.equal(value, id); ended = true; },
      saveRecording() { assert.fail('denied microphone must not save fake audio'); },
    },
    '@/lib/location': { sosSeed: value => ({ id: value }), currentDeviceLocation: () => null, watchDeviceLocation: () => () => {} },
    '@/lib/realtime': { joinSession: () => ({ leave() {}, send: async () => {} }) },
    '@/lib/network': { fetchJson() { assert.fail('offline SOS must not send a pin without GPS'); } },
  }, {
    navigator: { onLine: false, mediaDevices: { async getUserMedia() { microphoneCalls++; assert.equal(persisted, true); throw new Error('denied'); } } },
    MediaRecorder: class {}, AudioContext: class { constructor() { assert.fail('SOS must not start a siren'); } },
    document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
  }); t.after(() => app.dispose());
  await app.flush(); assert.equal(microphoneCalls, 0); assert.match(app.text(), /Starting/);
  commit(); await app.flush(); assert.equal(microphoneCalls, 1);
  assert.match(app.text(), /session saved on this phone/); assert.match(app.text(), /Microphone access was denied/);
  assert.match(app.text(), /SOS active/);
  const end = app.nodes(n => n.type === 'button' && JSON.stringify(n.props.children).includes("safe"))[0];
  assert.ok(end); await end.props.onClick(); assert.equal(ended, true); assert.equal(navigation, '/');
});
