import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const origin = 'https://herguardian.test';
function worker({ badModule = false, realModules = false } = {}) {
  const stores = new Map(), events = new Map(), fetched = [];
  let online = true, skipped = false;
  const key = value => new URL(typeof value === 'string' ? value : value.url, origin).href;
  const caches = { async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return { async match(request, options) {
      const response = entries.get(key(request));
      if (response?.headers.has('Vary') && !options?.ignoreVary) return undefined;
      return response?.clone();
    }, async put(request, response) { entries.set(key(request), response.clone()); } };
  }, async keys() { return [...stores.keys()]; }, async delete(name) { return stores.delete(name); } };
  const self = { location: { origin }, navigator: { get onLine() { return online; } },
    addEventListener(name, fn) { events.set(name, fn); }, async skipWaiting() { skipped = true; }, clients: { async claim() {} } };
  const context = vm.createContext({ self, caches, URL, Response, Headers, AbortController, setTimeout, clearTimeout,
    fetch: async request => {
      if (!online) throw new Error('offline');
      const url = new URL(typeof request === 'string' ? request : request.url, origin); fetched.push(url.pathname);
      if (url.pathname.endsWith('.mjs')) return new Response(realModules ? fs.readFileSync(`public${url.pathname}`) : badModule ? '<html>not a module</html>' : 'import "./maplibre-gl-shared.mjs";', {
        headers: { 'Content-Type': badModule ? 'text/html' : 'application/javascript', Vary: 'Origin' },
      });
      if (url.pathname.endsWith('.css')) return new Response('a{src:url(../media/font.woff2)}', { headers: { 'Content-Type': 'text/css' } });
      if (url.pathname.endsWith('.js')) return new Response('load("static/chunks/child.js"); const directory="static/chunks/"; url(this.tiles,this.map.getPixelRatio())', { headers: { 'Content-Type': 'application/javascript' } });
      if (url.pathname.startsWith('/_next/') || url.pathname.includes('.')) return new Response('asset');
      return new Response(`<h1>${url.pathname}</h1><script src="/_next/static/chunks/page.js"></script><link href="/_next/static/css/style.css">`, { headers: { 'Content-Type': 'text/html' } });
    } });
  vm.runInContext(fs.readFileSync('public/sw.js', 'utf8'), context);
  return { context, caches, stores, events, fetched, setOffline() { online = false; }, get skipped() { return skipped; },
    request(path) { return { url: origin + path }; } };
}
test('install prepares every public page and recursive scripts/fonts without previously visiting pages', async () => {
  const w = worker(); let install;
  w.events.get('install')({ waitUntil(promise) { install = promise; } }); await install;
  assert.equal(w.skipped, true);
  for (const path of ['/', '/sos', '/guardians', '/rights', '/help', '/login', '/maplibre-gl-worker.mjs', '/maplibre-gl-shared.mjs', '/_next/static/chunks/child.js', '/_next/static/media/font.woff2']) assert.ok(w.fetched.includes(path), path);
  assert.equal(w.fetched.includes('/_next/static/chunks/'), false);
  w.setOffline();
  for (const path of ['/sos', '/guardians', '/rights', '/help', '/login']) {
    const response = await w.context.networkFirstShell(w.request(path));
    assert.equal(response.status, 200); assert.ok((await response.text()).includes(`<h1>${path}</h1>`));
  }
});
test('offline unknown/dynamic routes never receive another page or expose a cached session', async () => {
  const w = worker(); await w.context.prepareOfflinePages(); w.setOffline();
  for (const path of ['/guard/session-id', '/dashboard', '/unknown']) {
    const response = await w.context.networkFirstShell(w.request(path));
    assert.equal(response.status, 503); assert.match(await response.text(), /This page needs internet/);
  }
  assert.match(await (await w.context.networkFirstShell(w.request('/rights?source=menu'))).text(), /<h1>\/rights<\/h1>/);
});
test('Next server-component requests are never answered with cached page HTML', async () => {
  const w = worker(); await w.context.prepareOfflinePages(); w.setOffline(); let handled = false;
  w.events.get('fetch')({ request: { url: origin + '/rights?_rsc=abc', method: 'GET', mode: 'cors' }, respondWith() { handled = true; } });
  assert.equal(handled, false);
});
test('upgrade removes obsolete app caches and preserves actual safety/journey records and unrelated caches', async () => {
  const w = worker();
  await w.context.prepareOfflinePages();
  for (const name of ['hg-v1-shell', 'hg-v1-shell-pages-v2', 'hg-v1-data', 'hg-v1-map-data', 'unrelated-app']) await w.caches.open(name);
  const saved = { savedAt: 123, value: { cells: ['saved factors'], journey: ['saved geometry'] } };
  const data = await w.caches.open('hg-v1-map-data'); await data.put('/__offline/safety', Response.json(saved));
  await data.put('/__offline/last-route', Response.json(saved));
  await (await w.caches.open('hg-v1-data')).put('/api/cells', Response.json(saved));
  let activation; w.events.get('activate')({ waitUntil(promise) { activation = promise; } }); await activation;
  assert.equal(w.stores.has('hg-v1-shell'), false);
  assert.equal(w.stores.has('hg-v1-shell-pages-v2'), false);
  for (const name of ['hg-v1-shell-pages-v3', 'hg-v1-data', 'hg-v1-map-data', 'unrelated-app']) assert.ok(w.stores.has(name));
  for (const key of ['/__offline/safety', '/__offline/last-route']) assert.deepEqual(await (await data.match(key)).json(), saved);
  assert.deepEqual(await (await (await w.caches.open('hg-v1-data')).match('/api/cells')).json(), saved);
});
test('offline programmatic navigation opens saved HTML; online navigation keeps Next router', () => {
  let online = false; const assigned = [], pushed = [], exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/navigation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, navigator: { get onLine() { return online; } }, window: { location: { assign(path) { assigned.push(path); } } } });
  exports.navigateTo('/sos', { push(path) { pushed.push(path); } });
  online = true; exports.navigateTo('/guardians', { push(path) { pushed.push(path); } });
  assert.deepEqual(assigned, ['/sos']); assert.deepEqual(pushed, ['/guardians']);
});

test('offline links use the requested page and preserve external, telephone and modified clicks', () => {
  const assigned = [], exports = {};
  class Element { closest() { return this; } }
  class Anchor extends Element { constructor(href) { super(); this.href = href; this.target = ''; } hasAttribute() { return false; } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/navigation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, Element, HTMLAnchorElement: Anchor, URL, navigator: { onLine: false }, window: { location: { href: origin + '/', origin, pathname: '/', search: '', assign(path) { assigned.push(path); } } } });
  const click = (href, extra = {}) => {
    let prevented = false, stopped = false;
    exports.offlineLink({ target: new Anchor(href), button: 0, preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; }, ...extra });
    return { prevented, stopped };
  };
  assert.deepEqual(click(origin + '/rights'), { prevented: true, stopped: true });
  assert.deepEqual(assigned, [origin + '/rights']);
  for (const href of ['tel:123', 'sms:123', 'https://another.test/page']) assert.equal(click(href).prevented, false);
  assert.equal(click(origin + '/help', { ctrlKey: true }).prevented, false);
});

test('offline SOS persists before marking queued and never attempts a server request; active offline UUID is reused', async () => {
  const source = fs.readFileSync('src/app/(bare)/sos/page.tsx', 'utf8');
  const body = source.split('void (async () => {')[1].split('})();')[0];
  for (const previous of [null, 'existing-session']) {
    const events = [];
    await vm.runInNewContext(`(async () => {${body}})()`, {
      cancelled: false, navigator: { onLine: false }, activeSessionId: () => previous,
      fetch: () => assert.fail('offline SOS must not wait for the server'),
      newId: () => 'new-session', sosSeed: id => ({ id, lat: null, lng: null }),
      queueRequest: async () => { events.push('persist'); return 1; }, setRecNote() {},
      setSessionId(id) { events.push(id); }, setActiveSession() { events.push('active'); },
      setPhase(phase) { events.push(phase); }, deliverQueuedRequest: () => assert.fail('no offline send'),
    });
    assert.deepEqual(events, previous ? ['existing-session', 'queued'] : ['persist', 'new-session', 'active', 'queued']);
  }
});

test('offline map worker and shared module are served from the prepared asset cache', async () => {
  const w = worker(); await w.context.prepareOfflinePages(); w.setOffline();
  for (const path of ['/maplibre-gl-worker.mjs', '/maplibre-gl-shared.mjs']) {
    let pending;
    w.events.get('fetch')({ request: { url: origin + path, method: 'GET', mode: 'cors' }, respondWith(promise) { pending = promise; } });
    assert.ok(pending); const response = await pending;
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /javascript/);
    assert.match(await response.text(), /import/);
  }
});

test('HTML disguised as a worker module prevents activation instead of becoming a broken offline module', async () => {
  const w = worker({ badModule: true }); let install;
  w.events.get('install')({ waitUntil(promise) { install = promise; } });
  await assert.rejects(install, /Offline preparation failed/);
  assert.equal(w.skipped, false);
});

test('invalid cached worker MIME is refreshed instead of returned as JavaScript', async () => {
  const w = worker();
  const cache = await w.caches.open('hg-v1-shell-pages-v3');
  await cache.put('/maplibre-gl-worker.mjs', new Response('<html>old response</html>', { headers: { 'Content-Type': 'text/html' } }));
  const response = await w.context.cacheFirst(w.request('/maplibre-gl-worker.mjs'));
  assert.match(response.headers.get('Content-Type'), /javascript/);
  assert.match((await cache.match('/maplibre-gl-worker.mjs', { ignoreVary: true })).headers.get('Content-Type'), /javascript/);
});

test('offline prepared MapLibre module pair contains the actual installed package bytes', async () => {
  const w = worker({ realModules: true }); await w.context.prepareOfflinePages(); w.setOffline();
  for (const path of ['/maplibre-gl-worker.mjs', '/maplibre-gl-shared.mjs']) {
    const response = await w.context.cacheFirst(w.request(path));
    assert.equal(await response.text(), fs.readFileSync(`node_modules/maplibre-gl/dist${path}`, 'utf8'));
  }
});
