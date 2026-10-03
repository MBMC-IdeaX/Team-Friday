import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';
const ID = '11111111-1111-4111-8111-111111111111';
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function load(file, globals, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Blob, Response, FormData, Buffer, AbortController, setTimeout, clearTimeout,
      require(name) { if (name in mocks) return mocks[name]; throw new Error(`Unexpected import ${name}`); }, ...globals });
  return exports;
}
function capture({ supported = ['audio/webm;codecs=opus'], deny = false, empty = false, persistFails = false, permission } = {}) {
  let now = 1000, trackStops = 0;
  const recorders = [], states = [], saved = [], timers = new Map(), intervals = new Map(), events = new Map();
  class Clock { static now() { return now; } }
  class Recorder {
    static isTypeSupported(type) { return supported.includes(type); }
    constructor(stream, options) { this.options = options; this.mimeType = options.mimeType ?? 'audio/webm'; this.state = 'inactive'; recorders.push(this); }
    start(timeslice) { this.timeslice = timeslice; this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => {
      this.ondataavailable({ data: new Blob(empty ? [] : ['complete-recording'], { type: this.mimeType }) });
      this.onstop();
    }); }
  }
  const stream = { getTracks: () => [{ stop() { trackStops++; } }] };
  const document = { visibilityState: 'visible', addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name, fn) { if (events.get(name) === fn) events.delete(name); } };
  const constraints = [];
  const api = load('src/lib/recording.ts', { MediaRecorder: Recorder, Date: Clock, document,
    navigator: { mediaDevices: { async getUserMedia(options) {
      constraints.push(options); if (deny) throw new Error('denied'); if (permission) await permission;
      return stream;
    } } },
    setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval(fn) { const id = {}; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
  });
  const start = () => api.startEvidenceRecording(async (blob, durationMs) => {
    if (persistFails) throw new Error('storage failed'); saved.push({ blob, durationMs });
  }, state => states.push(state));
  return { api, Recorder, recorders, states, saved, constraints, intervals, timers, start,
    get trackStops() { return trackStops; },
    segment() { const timer = [...timers.values()][0]; now += timer.ms; timer.fn(); },
    hide() { document.visibilityState = 'hidden'; events.get('visibilitychange')(); },
    show() { document.visibilityState = 'visible'; events.get('visibilitychange')(); },
  };
}
test('complete segments use supported MIME, controlled bitrate, binary concatenation and no timeslice uploads', async () => {
  const c = capture(); const handle = c.start(); await settle();
  const rec = c.recorders[0];
  assert.equal(rec.timeslice, undefined); assert.equal(rec.options.mimeType, 'audio/webm;codecs=opus');
  assert.equal(rec.options.audioBitsPerSecond, 64000); assert.equal(c.constraints[0].audio.noiseSuppression, true);
  rec.ondataavailable({ data: new Blob(['header-'], { type: rec.mimeType }) });
  assert.equal(c.saved.length, 0, 'a dataavailable fragment is not uploaded separately');
  c.segment(); await settle();
  assert.equal(await c.saved[0].blob.text(), 'header-complete-recording');
  assert.equal(c.saved[0].blob.type, rec.mimeType); assert.equal(c.saved[0].durationMs, 30000);
  assert.equal(c.recorders.length, 2); assert.equal(c.recorders[0].state, 'inactive');
  await handle.stop(); assert.equal(c.trackStops, 1); assert.equal(c.intervals.size, 0);
  assert.equal(c.states.at(-1).phase, 'stopped');
});
test('MIME falls back to supported MP4 or browser default without forcing an unsupported codec', async () => {
  for (const supported of [['audio/mp4'], []]) {
    const c = capture({ supported }); const h = c.start(); await settle();
    assert.equal(c.recorders[0].options.mimeType, supported[0]);
    await h.stop(); assert.ok(c.saved[0].blob.type);
  }
});
test('microphone denial and zero-byte recording are explicit failures independent of SOS', async () => {
  for (const options of [{ deny: true }, { empty: true }]) {
    const c = capture(options); const h = c.start(); await settle(); await h.stop();
    assert.equal(c.saved.length, 0); assert.equal(c.states.at(-1).phase, 'failed');
    assert.match(c.states.at(-1).message, /SOS is still active/); assert.equal(c.intervals.size, 0);
  }
});
test('failed local audio persistence stops capture and releases microphone without pretending it was saved', async () => {
  const c = capture({ persistFails: true }); const h = c.start(); await settle(); c.segment(); await settle();
  assert.equal(c.states.at(-1).phase, 'failed'); assert.equal(c.states.at(-1).savedSegments, 0);
  assert.equal(c.trackStops, 1); await h.stop();
});
test('cleanup during microphone permission releases late streams and never starts a recorder', async () => {
  let grant; const c = capture({ permission: new Promise(resolve => { grant = resolve; }) });
  const h = c.start(); await settle(); await h.stop();
  assert.equal(c.states.at(-1).phase, 'stopped', 'ending SOS does not wait for a permission dialog');
  grant(); await settle();
  assert.equal(c.recorders.length, 0); assert.equal(c.trackStops, 1);
});
test('new capture waits for the previous recorder to finalize, preventing overlapping microphone recordings', async () => {
  const c = capture(); const first = c.start(); await settle(); const second = c.start(); await settle();
  assert.equal(c.recorders[0].state, 'inactive'); assert.equal(c.recorders[1].state, 'recording');
  assert.equal(c.saved.length, 1); await second.stop(); await first.stop();
  assert.equal(c.recorders.filter(r => r.state === 'recording').length, 0);
});
test('page suspension finalizes a complete segment and returning resumes only after persistence', async () => {
  const c = capture(); const h = c.start(); await settle(); c.hide(); await settle();
  assert.equal(c.saved.length, 1); assert.equal(c.recorders.length, 1);
  c.show(); await settle(); assert.equal(c.recorders.length, 2); await h.stop();
});
test('recording hard limit stops the microphone and leaves completed segments locally persisted', async () => {
  const c = capture(); c.start(); await settle();
  for (let i = 0; i < 30; i++) { c.segment(); await settle(); }
  assert.equal(c.saved.length, 30); assert.equal(c.trackStops, 1);
  assert.equal(c.states.at(-1).phase, 'stopped'); assert.equal(c.states.at(-1).seconds, 900);
});

function recordingApi() {
  const objects = new Map(), uploads = [], session = { media_paths: [] };
  let missing = false, dbError = false, conflict = false, attachError = false;
  const sb = { storage: { from(bucket) { assert.equal(bucket, 'recordings'); return {
    async upload(path, bytes, options) {
      uploads.push({ path, bytes, options });
      if (objects.has(path)) return { error: { statusCode: '409' } };
      objects.set(path, bytes); return { error: null };
    },
  }; } }, from(table) {
    assert.equal(table, 'guardian_sessions'); let patch, expected;
    const q = {
      select() { return q; }, eq() { return q; }, update(value) { patch = value; return q; },
      filter(_, operator, text) { assert.equal(operator, 'eq'); expected = JSON.parse('[' + text.slice(1, -1) + ']'); return q; },
      is() { expected = null; return q; },
      async maybeSingle() {
        if (dbError) return { error: new Error('lookup failed') };
        if (missing) return { data: null };
        if (!patch) return { data: { media_paths: [...session.media_paths] } };
        if (attachError) return { error: new Error('write failed') };
        if (conflict) { conflict = false; session.media_paths.push('concurrent.webm'); return { data: null }; }
        if (JSON.stringify(expected) !== JSON.stringify(session.media_paths)) return { data: null };
        session.media_paths = patch.media_paths; return { data: { id: ID } };
      },
    }; return q;
  } };
  const route = load('src/app/api/recording/route.ts', {}, {
    'node:crypto': { createHash }, 'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/db': { dbConfigured: () => true, supabase: () => sb },
  });
  return { objects, uploads, session, missing() { missing = true; }, failLookup() { dbError = true; }, conflict() { conflict = true; }, failAttach() { attachError = true; },
    async upload(blob, id = ID) { const form = new FormData(); form.set('sessionId', id); form.set('file', blob, 'recording'); form.set('durationMs', '30000'); return route.POST({ formData: async () => form }); },
  };
}
test('private recording API preserves exact binary/MIME and retries produce one object and one session reference', async () => {
  const a = recordingApi(), bytes = new Uint8Array([137, 255, 0, 10, 34, 128]);
  const blob = new Blob([bytes], { type: 'audio/webm;codecs=opus' });
  const first = await a.upload(blob), retry = await a.upload(blob);
  assert.equal(first.status, 200); assert.equal(retry.status, 200);
  assert.equal((await first.json()).path, (await retry.json()).path);
  assert.equal(a.objects.size, 1); assert.equal(a.session.media_paths.length, 1);
  assert.deepEqual(new Uint8Array(a.uploads[0].bytes), bytes);
  assert.equal(a.uploads[0].options.contentType, blob.type); assert.equal(a.uploads[0].options.metadata.durationMs, 30000);
  assert.equal(a.uploads[0].options.upsert, undefined, 'no overwrite or public access shortcut');
});
test('recording API rejects empty/oversized/unsupported audio and missing sessions before creating objects', async () => {
  const a = recordingApi();
  assert.equal((await a.upload(new Blob([]))).status, 400);
  assert.equal((await a.upload(new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'audio/webm' }))).status, 413);
  assert.equal((await a.upload(new Blob(['text'], { type: 'text/html' }))).status, 415);
  assert.equal((await a.upload(new Blob(['audio'], { type: 'audio/webm' }), 'invalid')).status, 400);
  a.missing(); assert.equal((await a.upload(new Blob(['audio'], { type: 'audio/webm' }))).status, 404);
  assert.equal(a.objects.size, 0);
});
test('concurrent evidence append is retried without losing another recording; DB failures remain retryable', async () => {
  const a = recordingApi(); a.conflict();
  assert.equal((await a.upload(new Blob(['audio'], { type: 'audio/mp4' }))).status, 200);
  assert.equal(a.session.media_paths.length, 2); assert.equal(a.session.media_paths[0], 'concurrent.webm');
  const broken = recordingApi(); broken.failAttach();
  assert.equal((await broken.upload(new Blob(['audio'], { type: 'audio/webm' }))).status, 500);
  const lookup = recordingApi(); lookup.failLookup();
  assert.equal((await lookup.upload(new Blob(['audio'], { type: 'audio/webm' }))).status, 500);
  assert.equal(lookup.objects.size, 0);
});

test('offline recording queue preserves Blob bytes/MIME, makes no offline requests and serializes reconnect drains', async () => {
  const stores = new Map(), calls = []; let nextId = 1; const navigator = { onLine: false };
  const db = { transaction(store) {
    const rows = stores.get(store) ?? new Map(); stores.set(store, rows);
    const tx = { objectStore() { return {
      add(value) { const id = nextId++; return request(() => { rows.set(id, { ...value, id }); return id; }); },
      getAll() { return request(() => [...rows.values()]); }, delete(id) { return request(() => rows.delete(id)); },
    }; } };
    const request = operation => { const req = {}; queueMicrotask(() => { req.result = operation(); tx.oncomplete(); }); return req; };
    return tx;
  } };
  const api = load('src/lib/offline.ts', { navigator,
    indexedDB: { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req; } },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true }; },
  });
  const blob = new Blob([new Uint8Array([255, 0, 127])], { type: 'audio/webm;codecs=opus' });
  await assert.rejects(api.saveRecording(ID, new Blob([])), /Empty/);
  await api.saveRecording(ID, blob, 30000);
  assert.equal(await api.flushRecordings(), 1); assert.equal(calls.length, 0);
  const queued = (await api.pendingRecordings())[0]; assert.equal(queued.blob, blob); assert.equal(queued.blob.type, blob.type);
  navigator.onLine = true; const first = api.flushRecordings(), second = api.flushRecordings();
  assert.equal(first, second); assert.equal(await first, 0); assert.equal(calls.length, 1);
  const delivered = calls[0].options.body.get('file');
  assert.equal(delivered.type, blob.type); assert.deepEqual(await delivered.arrayBuffer(), await blob.arrayBuffer());
  assert.equal(calls[0].options.body.get('durationMs'), '30000');
});
