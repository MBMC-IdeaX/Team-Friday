import assert from "node:assert/strict";
import test from "node:test";

import { matchesSos } from "../src/lib/voice.ts";

// A false SOS trains guardians to ignore alerts, which is worse than having no
// voice trigger. So the matcher has to reject plausible near-misses.

test("matches the intended phrases", () => {
  for (const p of ["help me", "HELP ME", "bachao", "bāchāu help me", "sos", "Emergency"]) {
    assert.ok(matchesSos(p), `should match: ${p}`);
  }
});

test("matches a phrase inside a longer sentence", () => {
  assert.ok(matchesSos("please help me someone is following"));
  assert.ok(matchesSos("um, help me right now"));
});

test("rejects a bare 'help' — far too common in ordinary speech", () => {
  assert.equal(matchesSos("help"), false);
  assert.equal(matchesSos("can you help"), false);
  assert.equal(matchesSos("she helped me"), false);
});

test("rejects unrelated speech", () => {
  for (const p of ["", "hello there", "where is the station", "so", "help desk number"]) {
    assert.equal(matchesSos(p), false, `should not match: ${p}`);
  }
});

test("normalises punctuation and case", () => {
  assert.ok(matchesSos("HELP ME!!!"));
  assert.ok(matchesSos("  help   me  "));
  assert.ok(matchesSos("s-o-s"));
});
