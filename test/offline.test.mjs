import assert from "node:assert/strict";
import test from "node:test";

import { drain, newId } from "../src/lib/offline.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The check for the one piece of non-trivial logic in the outbox: ordering and
// stop-on-failure. If drain ever sends a later item past a failed earlier one,
// an SOS session could go out ahead of the report it follows.

const ok = async () => true;

test("drain returns every item when all sends succeed", async () => {
  assert.deepEqual(await drain([1, 2, 3], ok), [1, 2, 3]);
});

test("drain is empty for an empty queue", async () => {
  assert.deepEqual(await drain([], ok), []);
});

test("drain stops at the first failure", async () => {
  const attempted = [];
  const sent = await drain([1, 2, 3], async (i) => {
    attempted.push(i);
    return i !== 2;
  });
  assert.deepEqual(sent, [1]);
  assert.deepEqual(attempted, [1, 2], "must not attempt item 3 after item 2 failed");
});

test("drain treats a thrown send as a failure", async () => {
  const sent = await drain([1, 2], async (i) => {
    if (i === 1) throw new Error("offline");
    return true;
  });
  assert.deepEqual(sent, []);
});

test("drain preserves queue order, not object key order", async () => {
  const items = [{ id: 3 }, { id: 1 }, { id: 2 }];
  const seen = [];
  await drain(items, async (i) => {
    seen.push(i.id);
    return true;
  });
  assert.deepEqual(seen, [3, 1, 2], "drain does not sort; the caller owns order");
});
// The LAN-demo bug: crypto.randomUUID is undefined on insecure origins, and the
// SOS screen died on that. newId() must produce a real v4 either way.
test("newId returns a v4 uuid", () => {
  for (let i = 0; i < 50; i++) assert.match(newId(), UUID_V4);
});

test("newId does not collide", () => {
  const seen = new Set(Array.from({ length: 500 }, newId));
  assert.equal(seen.size, 500);
});

test("newId falls back when randomUUID is unavailable", () => {
  const real = globalThis.crypto.randomUUID;
  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined, configurable: true,
    });
    assert.equal(typeof crypto.randomUUID, "undefined", "precondition");
    for (let i = 0; i < 50; i++) assert.match(newId(), UUID_V4);
  } finally {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: real, configurable: true,
    });
  }
});
