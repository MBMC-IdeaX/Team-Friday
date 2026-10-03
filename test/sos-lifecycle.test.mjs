import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const A = '11111111-1111-4111-8111-111111111111';
function load(path, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => {
    if (name in mocks) return mocks[name]; throw new Error(`Unexpected ${name}`);
  }, console, crypto: globalThis.crypto, ...globals });
  return exports;
}
function storage() {
  let nextId = 1, active = A, abort = null, hold = null;
  const rows = new Map(), events = [], calls = [];
  const db = { transaction() {
    const tx = { error: null, objectStore() { return {
      add: value => request('add', value), delete: key => request('delete', key), getAll: () => request('getAll'),
    }; } };
    function request(action, value) {
      const req = {}; const key = action === 'add' ? nextId++ : value;
      const finish = () => {
        req.result = action === 'getAll' ? [...rows.values()] : action === 'add' ? key : undefined;
        req.onsuccess?.();
        events.push(`request:${action}`);
        queueMicrotask(() => {
          if (abort === action) {
            tx.error = new Error('transaction aborted'); abort = null; tx.onabort(); return;
          }
          if (action === 'add') rows.set(key, { ...value, id: key });
          if (action === 'delete') rows.delete(key);
          events.push(`commit:${action}`); tx.oncomplete();
        });
      };
      if (hold === action) pending = finish; else queueMicrotask(finish);
      return req;
    }
    return tx;
  } };
  let pending;
  const offline = load('src/lib/offline.ts', {}, {
    indexedDB: { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req; } },
    localStorage: { getItem: () => active, setItem: (_, id) => { active = id; }, removeItem: () => { events.push('clear-active'); active = null; } },
    fetch: async (url, init) => { calls.push({ url, init }); if (network instanceof Error) throw network; return { ok: network }; },
  });
  let network = true;
  return { offline, rows, events, calls, get active() { return active; },
    network(value) { network = value; }, abort(action) { abort = action; },
    hold(action) { hold = action; }, release() { hold = null; pending(); } };
}
test('initial direct success acknowledges only exact queued entry; failure retains it', async () => {
  const s = storage(); const first = await s.offline.queueRequest('/api/sos', { id: A });
  const other = await s.offline.queueRequest('/api/sos', { id: 'other' });
  assert.equal(await s.offline.deliverQueuedRequest(first, '/api/sos', { id: A }), true);
  assert.equal(s.rows.has(first), false); assert.equal(s.rows.has(other), true);
  s.network(false); assert.equal(await s.offline.deliverQueuedRequest(other, '/api/sos', {}), false);
  assert.equal(s.rows.has(other), true);
});
test('request success is not persistence; insertion and deletion abort reject', async () => {
  const s = storage(); s.abort('add');
  await assert.rejects(s.offline.queueRequest('/api/sos', { id: A }), /aborted/); assert.equal(s.rows.size, 0);
  const key = await s.offline.queueRequest('/api/sos', { id: A }); s.abort('delete');
  await assert.rejects(s.offline.acknowledgeRequest(key), /aborted/); assert.equal(s.rows.has(key), true);
  s.abort('delete'); assert.equal(await s.offline.deliverQueuedRequest(key, '/api/sos', {}), true);
  assert.equal(s.rows.has(key), true, 'delivery succeeded but failed acknowledgement remains replayable');
});
test('offline end commits terminal intent before clearing local activity; reconnect sends PATCH', async () => {
  const s = storage(); s.network(new Error('offline'));
  const delivered = await s.offline.endSosSession(A); assert.equal(delivered, false);
  assert.equal(s.active, null); assert.equal(s.rows.size, 1);
  assert.ok(s.events.indexOf('commit:add') < s.events.indexOf('clear-active'));
  const row = [...s.rows.values()][0]; assert.equal(row.method, 'PATCH');
  assert.deepEqual(JSON.parse(row.body), { id: A, status: 'resolved' });
  s.network(true); assert.equal(await s.offline.flushOutbox(), 1); assert.equal(s.rows.size, 0);
  assert.equal(s.calls.at(-1).init.method, 'PATCH');
});
test('failed terminal persistence leaves local active UUID intact', async () => {
  const s = storage(); s.abort('add'); await assert.rejects(s.offline.endSosSession(A));
  assert.equal(s.active, A); assert.equal(s.calls.length, 0);
});
test('successful terminal delivery acknowledges exact entry and preserves unrelated queue', async () => {
  const s = storage(); const other = await s.offline.queueRequest('/api/report', {});
  assert.equal(await s.offline.endSosSession(A), true);
  assert.deepEqual([...s.rows.keys()], [other]);
});
test('same-page concurrent drains share one flight and acknowledge each success', async () => {
  const s = storage(); await s.offline.queueRequest('/api/sos', {}); s.hold('getAll');
  const first = s.offline.flushOutbox(); const second = s.offline.flushOutbox(); assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve)); s.release();
  assert.equal(await first, 1); assert.equal(s.calls.length, 1); assert.equal(s.rows.size, 0);
});
function api() {
  const sessions = new Map(), jobs = []; let pushes = 0;
  const sb = { async rpc(name, p) {
    if (name === 'persist_sos_initial') {
      const created = !sessions.has(p.p_id);
      if (created) sessions.set(p.p_id, { id: p.p_id, status: 'active', lat: p.p_lat, lng: p.p_lng, triggered_by: p.p_triggered_by });
      return { data: created, error: null };
    }
    if (name === 'persist_sos_terminal') {
      const existing = sessions.get(p.p_id);
      if (!existing) sessions.set(p.p_id, { id: p.p_id, status: p.p_status, triggered_by: null, lat: null, lng: null });
      else if (existing.status === 'active') existing.status = p.p_status;
      return { error: null };
    }
    assert.fail(`unexpected RPC ${name}`);
  }, from() {
    let patch, id, status;
    const q = { update(p) { patch = p; return q; }, eq(k, v) { if (k === 'id') id = v; else status = v; return q; },
      select() { return q; }, async maybeSingle() {
        const row = sessions.get(id); if (!row || row.status !== status) return { data: null, error: null };
        Object.assign(row, patch); return { data: { id }, error: null };
      } };
    return q;
  } };
  const route = load('src/app/api/sos/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) }, after: fn => jobs.push(fn) },
    '@/lib/db': { dbConfigured: () => true, supabase: () => sb },
    '@/lib/push-server': { alertGuardians: async () => { pushes++; return 0; } },
  }, { console: { info() {}, error() {} } });
  const req = body => ({ json: async () => body });
  return { sessions, jobs, get pushes() { return pushes; },
    create: (extra = {}) => route.POST(req({ id: A, triggered_by: 'tap', lat: 27, lng: 85, ...extra })),
    patch: body => route.PATCH(req({ id: A, ...body })) };
}
test('first and concurrent duplicate creation produce one active row and one initial schedule', async () => {
  const a = api(); const replies = await Promise.all([a.create(), a.create(), a.create()]);
  assert.deepEqual(await Promise.all(replies.map(async r => (await r.json()).created)), [true, false, false]);
  assert.equal(a.sessions.get(A).status, 'active'); assert.equal(a.jobs.length, 1);
  await a.jobs[0](); assert.equal(a.pushes, 1);
});
test('initial replay is complete no-op for newer coordinates and trigger', async () => {
  const a = api(); await a.create(); const row = a.sessions.get(A);
  Object.assign(row, { lat: 30, lng: 90, triggered_by: 'voice' }); const before = { ...row };
  const response = await a.create(); assert.equal((await response.json()).created, false);
  assert.deepEqual(row, before); assert.equal(a.jobs.length, 1);
});
for (const status of ['resolved', 'ended']) test(`${status} before/after creation is authoritative; replay and stale active/location PATCH cannot reverse it`, async () => {
  for (const terminalFirst of [false, true]) {
    const a = api(); if (!terminalFirst) await a.create();
    assert.equal((await a.patch({ status })).status, 200);
    const before = { ...a.sessions.get(A) };
    await a.patch({ status }); await a.create();
    assert.equal((await a.patch({ status: 'active', lat: 31, lng: 91 })).status, 404);
    assert.deepEqual(a.sessions.get(A), before);
    assert.equal(a.jobs.length, terminalFirst ? 0 : 1);
    if (terminalFirst) assert.equal(before.triggered_by, null);
  }
});
test('concurrent create/terminal orderings finish terminal, and missing active PATCH is truthful', async () => {
  for (const terminalFirst of [false, true]) {
    const a = api(); await Promise.all(terminalFirst ? [a.patch({ status: 'resolved' }), a.create()] : [a.create(), a.patch({ status: 'resolved' })]);
    assert.equal(a.sessions.get(A).status, 'resolved');
  }
  assert.equal((await api().patch({ lat: 30, lng: 90 })).status, 404);
});
test('both UI paths use durable end; SQL no-op and atomic terminal semantics are reviewed structurally', () => {
  for (const file of ['src/app/sos/page.tsx', 'src/components/map-view.tsx']) {
    const code = fs.readFileSync(file, 'utf8'); assert.match(code, /await endSosSession\(/); assert.doesNotMatch(code, /clearActiveSession\(/);
  }
  const sql = fs.readFileSync('supabase/schema.sql', 'utf8');
  const initial = sql.split('create or replace function public.persist_sos_initial(')[1].split('$$;')[0];
  assert.match(initial, /on conflict \(id\) do nothing/); assert.doesNotMatch(initial, /\bupdate\b/i);
  assert.match(sql, /where public.guardian_sessions.status = 'active'/);
  assert.match(sql, /alter column triggered_by drop not null/);
  assert.match(sql, /revoke all on function public.persist_sos_terminal\(uuid, text\) from public, anon, authenticated/);
});
