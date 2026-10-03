// Checks the S.7 recording upload: a fake binary fixture lands in the private
// bucket and gets appended to guardian_sessions.media_paths; bad input rejected.
// Run with the dev server up:
//   node scripts/check-recording.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://localhost:3000";

const newSession = async () => {
  const id = crypto.randomUUID();
  const res = await fetch(`${BASE}/api/sos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, triggered_by: "tap", lat: 27.7172, lng: 85.324 }),
  });
  assert.equal(res.status, 200, "session create failed");
  return id;
};

const upload = (sessionId, blob, filename = "chunk.webm") => {
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("file", blob, filename);
  return fetch(`${BASE}/api/recording`, { method: "POST", body: form }).then(async (r) => ({
    status: r.status,
    json: await r.json(),
  }));
};

const paths = (id) =>
  fetch(`${BASE}/api/sos?id=${id}`)
    .then((r) => r.json())
    .then((j) => j.session.media_paths ?? []);

let n = 0;
const expect = (label, r, status, extra = () => true) => {
  console.log(`${label.padEnd(28)} ${String(r.status).padEnd(4)} ${JSON.stringify(r.json).slice(0, 70)}`);
  assert.equal(r.status, status, `${label}: expected ${status}, got ${r.status}`);
  assert.ok(extra(r.json), `${label}: unexpected body`);
  n++;
};

const id = await newSession();
const audio = new Blob([new Uint8Array(2048)], { type: "audio/webm;codecs=opus" });
// FAKE transport fixtures; use a real-device microphone test for playability.
const secondAudio = new Blob([new Uint8Array([1]), new Uint8Array(2047)], { type: audio.type });

expect("upload chunk", await upload(id, audio), 200, (j) => j.ok && j.path.startsWith(`${id}/`));
expect("retry does not duplicate", await upload(id, audio), 200);
assert.equal((await paths(id)).length, 1, "retry must preserve one reference");
expect("second recording appends", await upload(id, secondAudio), 200);
expect("bad sessionId", await upload("nope", audio), 400);
expect("missing file", await upload(id, new Blob([]), "x.webm"), 400);
expect("oversize chunk", await upload(id, new Blob([new Uint8Array(3 * 1024 * 1024)])), 413);

const stored = await paths(id);
assert.equal(stored.length, 2, `expected 2 paths, got ${stored.length}: ${stored}`);
console.log(`media_paths               2    ${JSON.stringify(stored)}`);
n++;

console.log(`\nrecording API OK — ${n} assertions`);
