import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const endpoint = 'https://fcm.googleapis.com/fcm/send/test';
const keys = { p256dh: 'A'.repeat(87), auth: 'A'.repeat(22) };
function load(path, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    if (name in mocks) return mocks[name];
    if (name.endsWith('push-contract')) return load('src/lib/push-contract.ts');
    throw new Error(`Unexpected dependency: ${name}`);
  }, URL, URLSearchParams, AbortSignal, Uint8Array, setTimeout, clearTimeout, atob,
  console, process: { env: { NODE_ENV: 'development', NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'AAAA', VAPID_PRIVATE_KEY: 'mock' } }, ...globals });
  return exports;
}
const request = (body, query = {}) => ({ json: async () => body,
  nextUrl: new URL(`https://example.test/?${new URLSearchParams(query)}`) });
const next = { NextResponse: { json: (data, init) => Response.json(data, init) } };
function database() {
  const sessions = new Set([A, B]);
  const subscriptions = new Map();
  const associations = new Map();
  let failure = false;
  let nextId = 1;
  const sb = {
    from(table) {
      let action = 'select'; const filters = {}; let patch;
      const query = {
        select() { assert.notEqual(table, 'push_subscriptions', 'No global subscription SELECT'); return query; },
        eq(key, value) { filters[key] = value; return query; },
        update(value) { action = 'update'; patch = value; return query; },
        delete() { action = 'delete'; return query; },
        maybeSingle() { return execute(true); },
        then(resolve, reject) { return execute(false).then(resolve, reject); },
      };
      async function execute(single) {
        if (failure) return { data: null, error: { message: 'mock failure' } };
        if (table === 'guardian_sessions') return { data: sessions.has(filters.id) ? { id: filters.id } : null, error: null };
        if (table === 'push_subscription_sessions') {
          const rows = [...associations.values()].filter(r => r.session_id === filters.session_id &&
            (!filters['push_subscriptions.endpoint'] || r.push_subscriptions.endpoint === filters['push_subscriptions.endpoint']));
          return { data: single ? rows[0] ?? null : rows, error: null };
        }
        const sub = [...subscriptions.values()].find(s => s.id === filters.id);
        if (action === 'delete' && sub) {
          subscriptions.delete(sub.endpoint);
          for (const [key, row] of associations) if (row.push_subscriptions.id === sub.id) associations.delete(key);
        } else if (sub) Object.assign(sub, patch);
        return { error: null };
      }
      return query;
    },
    async rpc(name, p) {
      if (failure) return { data: null, error: { message: 'mock failure' } };
      if (name === 'persist_sos_initial') {
        const created = !sessions.has(p.p_id); sessions.add(p.p_id); return { data: created, error: null };
      }
      if (name === 'subscribe_push_session') {
        if (!sessions.has(p.p_session_id)) return { error: { message: 'FK' } };
        const sub = subscriptions.get(p.p_endpoint) ?? { id: nextId++, endpoint: p.p_endpoint, fail_count: 0 };
        Object.assign(sub, { p256dh: p.p_p256dh, auth: p.p_auth }); subscriptions.set(p.p_endpoint, sub);
        associations.set(`${sub.id}/${p.p_session_id}`, { session_id: p.p_session_id, push_subscriptions: sub });
      } else {
        const sub = subscriptions.get(p.p_endpoint);
        if (sub) {
          associations.delete(`${sub.id}/${p.p_session_id}`);
          if (![...associations.values()].some(r => r.push_subscriptions.id === sub.id)) subscriptions.delete(p.p_endpoint);
        }
      }
      return { error: null };
    },
  };
  return { sb, sessions, subscriptions, associations, fail() { failure = true; },
    mocks: { '@/lib/db': { dbConfigured: () => true, supabase: () => sb }, 'next/server': next } };
}
const subscribe = d => load('src/app/api/push/subscribe/route.ts', d.mocks);
const body = sessionId => ({ endpoint, ...keys, sessionId });

test('flat client payload carries actual UUID and rejects missing keys/invalid UUID/unsafe endpoints', () => {
  const contract = load('src/lib/push-contract.ts');
  assert.deepEqual(JSON.parse(JSON.stringify(contract.subscriptionPayload({ endpoint, keys }, A))), body(A));
  assert.throws(() => contract.subscriptionPayload({ endpoint }, A));
  assert.throws(() => contract.subscriptionPayload({ endpoint, keys }, 'guardian'));
  assert.equal(contract.isPushEndpoint('https://localhost/secret'), false);
 });
test('API rejects invalid UUID, nested keys, missing session, and reports DB failures', async () => {
  const d = database(), api = subscribe(d);
  assert.equal((await api.POST(request(body('guardian')))).status, 400);
  assert.equal((await api.POST(request({ endpoint, keys, sessionId: A }))).status, 400);
  d.sessions.delete(A);
  assert.equal((await api.POST(request(body(A)))).status, 404);
  d.fail();
  assert.equal((await api.POST(request(body(B)))).status, 500);
 });
test('one endpoint follows A and B, duplicates dedupe; delete preserves B then removes orphan', async () => {
  const d = database(), api = subscribe(d);
  for (const id of [A, B, A]) assert.equal((await api.POST(request(body(id)))).status, 200);
  assert.equal(d.subscriptions.size, 1); assert.equal(d.associations.size, 2);
  assert.equal((await (await api.GET(request(null, { endpoint, sessionId: A }))).json()).armed, true);
  await api.DELETE(request(null, { endpoint, sessionId: A }));
  assert.equal(d.associations.size, 1); assert.equal(d.subscriptions.size, 1);
  assert.equal((await (await api.GET(request(null, { endpoint, sessionId: A }))).json()).armed, false);
  await api.DELETE(request(null, { endpoint, sessionId: B })); assert.equal(d.subscriptions.size, 0);
 });
test('DELETE and GET return failures truthfully', async () => {
  const d = database(), api = subscribe(d); d.fail();
  assert.equal((await api.DELETE(request(null, { endpoint, sessionId: A }))).status, 500);
  assert.equal((await api.GET(request(null, { endpoint, sessionId: A }))).status, 500);
 });
function sender(d, sendNotification, globals = {}) {
  return load('src/lib/push-server.ts', { ...d.mocks,
    'web-push': { default: { setVapidDetails() {}, sendNotification } } }, globals);
}
test('sender selects A only, payload has no coordinates, lookup failure never broadcasts', async () => {
  const d = database(), api = subscribe(d);
  await api.POST(request(body(A)));
  await api.POST(request({ ...body(B), endpoint: `${endpoint}-B` }));
  const sends = [];
  const push = sender(d, async (s, payload) => sends.push({ s, payload: JSON.parse(payload) }));
  assert.equal(await push.alertGuardians(A), 1);
  assert.equal(sends[0].s.endpoint, endpoint);
  assert.deepEqual(sends[0].payload, { sessionId: A, title: 'HerGuardian SOS', body: 'Emergency SOS activated. Tap to view the guardian session.' });
  d.fail(); await assert.rejects(push.alertGuardians(A)); assert.equal(sends.length, 1);
 });
for (const statusCode of [404, 410]) test(`provider ${statusCode} prunes endpoint and associations`, async () => {
  const d = database(); await subscribe(d).POST(request(body(A)));
  const push = sender(d, async () => { throw { statusCode }; });
  assert.equal(await push.alertGuardians(A), 0); assert.equal(d.subscriptions.size, 0); assert.equal(d.associations.size, 0);
 });
test('maintenance error is reported without leaking provider details', async () => {
  const d = database(); await subscribe(d).POST(request(body(A))); const errors = [];
  const push = sender(d, async () => d.fail(), { console: { error: x => errors.push(x) } });
  assert.equal(await push.alertGuardians(A), 1); assert.deepEqual(errors, ['Push subscription maintenance failed.']);
 });
test('first creation schedules once; replay and concurrent duplicate schedule no additional alert', async () => {
  const d = database(); d.sessions.delete(A); const jobs = []; let sends = 0;
  const api = load('src/app/api/sos/route.ts', { ...d.mocks,
    'next/server': { ...next, after: job => jobs.push(job) },
    '@/lib/push-server': { alertGuardians: async () => { sends++; return 0; } } }, { console: { info() {}, error() {} } });
  const req = () => request({ id: A, triggered_by: 'tap', lat: 27, lng: 85 });
  const responses = await Promise.all([api.POST(req()), api.POST(req()), api.POST(req())]);
  assert.deepEqual(await Promise.all(responses.map(async r => (await r.json()).pushScheduled)), [true, false, false]);
  assert.equal(jobs.length, 1); assert.equal(sends, 0); await jobs[0](); assert.equal(sends, 1);
  await api.POST(req()); assert.equal(jobs.length, 1);
 });
test('manual alert disabled in production; development requires stored session and ignores coordinates', async () => {
  const d = database(); const sent = [];
  const mocks = { ...d.mocks, '@/lib/push-server': { alertGuardians: async (...args) => { sent.push(args); return 1; } } };
  const prod = load('src/app/api/push/alert/route.ts', mocks, { process: { env: { NODE_ENV: 'production' } } });
  assert.equal((await prod.POST(request({ sessionId: A }))).status, 404); assert.equal(sent.length, 0);
  const dev = load('src/app/api/push/alert/route.ts', mocks);
  d.sessions.delete(B); assert.equal((await dev.POST(request({ sessionId: B }))).status, 404);
  assert.equal((await dev.POST(request({ sessionId: A, lat: 1, lng: 2 }))).status, 200);
  assert.deepEqual(sent, [[A]]);
 });
function worker() {
  const handlers = {}, shown = [], opened = [], jobs = [];
  vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), { URL,
    self: { location: { origin: 'https://example.test' }, addEventListener: (type, fn) => handlers[type] = fn,
      registration: { showNotification: async (...args) => shown.push(args) },
      clients: { matchAll: async () => [{ url: `https://evil.test/guard/${A}`, focus: () => assert.fail('foreign client') }],
        openWindow: async path => opened.push(path) } } });
  return { handlers, shown, opened, waitUntil: job => jobs.push(job), settle: () => Promise.all(jobs) };
}
test('worker ignores malformed/invalid payloads; valid push fixes visible text and click stays same-origin', async () => {
  const w = worker();
  w.handlers.push({ data: { json() { throw new Error('bad JSON'); } }, waitUntil: w.waitUntil });
  w.handlers.push({ data: { json: () => ({ sessionId: '../attack' }) }, waitUntil: w.waitUntil });
  assert.equal(w.shown.length, 0);
  w.handlers.push({ data: { json: () => ({ sessionId: A, title: 'coords', body: '27,85', url: 'https://evil.test' }) }, waitUntil: w.waitUntil });
  w.handlers.notificationclick({ notification: { close() {}, data: { sessionId: A, url: 'https://evil.test' } }, waitUntil: w.waitUntil });
  w.handlers.notificationclick({ notification: { close() {}, data: { sessionId: 'https://evil.test' } }, waitUntil: w.waitUntil });
  await w.settle(); assert.equal(w.shown[0][0], 'HerGuardian SOS');
  assert.equal(w.shown[0][1].body.includes('27'), false);
  assert.deepEqual(w.opened, [`https://example.test/guard/${A}`]);
 });
test('client reports API failure, permission denial, subscribe failure, and checks server association', async () => {
  const reg = { pushManager: { getSubscription: async () => ({ endpoint, toJSON: () => ({ endpoint, keys }) }) } };
  const notification = { permission: 'granted', requestPermission: async () => 'granted' };
  let response = Response.json({ armed: false }); const requests = [];
  const client = load('src/lib/push.ts', {}, { window: { PushManager: {}, Notification: notification }, Notification: notification,
    navigator: { serviceWorker: { ready: Promise.resolve(reg) } }, fetch: async (url, init) => { requests.push({ url, init }); return response.clone(); } });
  assert.equal(await client.currentPushEnabled(A), false);
  response = Response.json({ armed: true }); assert.equal(await client.currentPushEnabled(A), true);
  assert.equal((await client.enablePush(A)).ok, true);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), body(A));
  response = Response.json({}, { status: 500 }); assert.equal((await client.enablePush(A)).ok, false);
  notification.requestPermission = async () => 'denied'; assert.equal((await client.enablePush(A)).ok, false);
  notification.requestPermission = async () => 'granted'; reg.pushManager.getSubscription = async () => null;
  reg.pushManager.subscribe = async () => { throw new Error('provider secret'); };
  assert.equal((await client.enablePush(A)).ok, false);
 });
test('client handles unavailable SW and missing browser keys', async () => {
  const notification = { permission: 'granted', requestPermission: async () => 'granted' };
  const globals = { window: { PushManager: {}, Notification: notification }, Notification: notification,
    navigator: { serviceWorker: { ready: new Promise(() => {}) } },
    setTimeout: fn => { queueMicrotask(fn); return 1; }, clearTimeout() {} };
  const client = load('src/lib/push.ts', {}, globals); assert.equal((await client.enablePush(A)).ok, false);
  globals.navigator.serviceWorker.ready = Promise.resolve({ pushManager: {
    getSubscription: async () => ({ toJSON: () => ({ endpoint }) }) } });
  assert.equal((await load('src/lib/push.ts', {}, globals).enablePush(A)).ok, false);
 });
test('SQL concurrency protections and service-role-only grants are present', () => {
  const sql = fs.readFileSync('supabase/schema.sql', 'utf8');
  assert.match(sql, /primary key \(push_subscription_id, session_id\)/);
  assert.match(sql, /where endpoint = p_endpoint for update/);
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /get diagnostics inserted_count = row_count/);
  assert.match(sql, /revoke all on function public.persist_sos_initial[\s\S]*from public, anon, authenticated/);
  // The unchanged fetch/cache prefix is reviewed separately against HEAD.
 });

test('association RPC failure never reports armed or successful subscription', async () => {
  const d = database();
  d.sb.rpc = async () => ({ error: { message: 'association failed' } });
  const api = subscribe(d);
  assert.equal((await api.POST(request(body(A)))).status, 500);
  assert.equal((await (await api.GET(request(null, { endpoint, sessionId: A }))).json()).armed, false);
});
test('failed SOS persistence never schedules; failed push leaves persisted SOS successful', async () => {
  const d = database(); d.sessions.delete(A); const jobs = [], errors = [];
  const api = load('src/app/api/sos/route.ts', { ...d.mocks,
    'next/server': { ...next, after: job => jobs.push(job) },
    '@/lib/push-server': { alertGuardians: async () => { throw new Error('provider failure'); } } },
    { console: { info() {}, error: text => errors.push(text) } });
  const response = await api.POST(request({ id: A, triggered_by: 'tap', lat: 27, lng: 85 }));
  assert.equal(response.status, 200); await jobs[0](); assert.equal(d.sessions.has(A), true); assert.equal(errors.length, 1);
  d.fail(); assert.equal((await api.POST(request({ id: B, triggered_by: 'tap', lat: 27, lng: 85 }))).status, 500);
  assert.equal(jobs.length, 1);
});
