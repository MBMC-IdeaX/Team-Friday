// Manual API smoke test for /api/sos. Run with the dev server up:
//   node scripts/check-sos.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE ?? "http://localhost:3000";

const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 80);
  }
  return { status: res.status, json };
};

const show = (label, r) => {
  console.log(`${label.padEnd(22)} ${String(r.status).padEnd(4)} ${JSON.stringify(r.json).slice(0, 88)}`);
  return r;
};

const id = crypto.randomUUID();
let ok = 0;
const expect = (label, r, status, extra = () => true) => {
  show(label, r);
  assert.equal(r.status, status, `${label}: expected ${status}, got ${r.status}`);
  assert.ok(extra(r.json), `${label}: unexpected body`);
  ok++;
};

expect("create", await call("POST", "/api/sos", { id, triggered_by: "tap", lat: 27.7172, lng: 85.324 }), 200, (j) => j.ok && j.id === id);
expect("create replayed", await call("POST", "/api/sos", { id, triggered_by: "tap", lat: 27.7172, lng: 85.324 }), 200, (j) => j.ok);
expect("move pin", await call("PATCH", "/api/sos", { id, lat: 27.6961, lng: 85.3157 }), 200, (j) => j.ok);
expect("read back", await call("GET", `/api/sos?id=${id}`), 200, (j) => Math.abs(j.session.lat - 27.6961) < 1e-9);
expect("bad uuid", await call("POST", "/api/sos", { id: "nope", triggered_by: "tap", lat: 1, lng: 1 }), 400);
expect("bad trigger", await call("POST", "/api/sos", { id, triggered_by: "x", lat: 1, lng: 1 }), 400);
expect("no latlng", await call("POST", "/api/sos", { id, triggered_by: "tap" }), 400);
expect("non-numeric coords", await call("POST", "/api/sos", { id, triggered_by: "tap", lat: "a", lng: {} }), 400);
expect("empty patch", await call("PATCH", "/api/sos", { id }), 400);
expect("unknown session", await call("GET", `/api/sos?id=${crypto.randomUUID()}`), 404);
expect("resolve", await call("PATCH", "/api/sos", { id, status: "resolved" }), 200, (j) => j.ok);
expect("status persisted", await call("GET", `/api/sos?id=${id}`), 200, (j) => j.session.status === "resolved");

console.log(`\nsos API OK — ${ok} assertions, session ${id}`);