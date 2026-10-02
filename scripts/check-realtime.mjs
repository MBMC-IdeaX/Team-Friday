// Verifies the Realtime Broadcast path without a browser: two independent
// anon clients on the same topic, exactly what the SOS screen and the guardian
// page do. Run with the dev server up:
//   node scripts/check-realtime.mjs
import assert from "node:assert/strict";

import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TOPIC = `sos:${crypto.randomUUID()}`;

const mk = () => createClient(url, key, { auth: { persistSession: false } });
const victim = mk();
const guardian = mk();

const got = [];
const seen = [];
const channel = guardian.channel(TOPIC, { config: { broadcast: { self: false } } });
channel.on("broadcast", { event: "pin" }, ({ payload }) => got.push(payload));

const opened = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    reject(new Error(`guardian channel never opened, statuses seen: ${seen.join(",") || "none"}`));
  }, 15000);
  channel.subscribe((status, err) => {
    seen.push(err ? `${status}(${err.message})` : status);
    if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(true); }
  });
});
assert.ok(opened, "channel should report SUBSCRIBED");

const sender = victim.channel(TOPIC);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("victim channel never opened")), 15000);
  sender.subscribe((status, err) => {
    if (err) { clearTimeout(timer); reject(err); }
    if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(true); }
  });
});
const ack = await sender.send({
  type: "broadcast",
  event: "pin",
  payload: { lat: 27.7172, lng: 85.324, at: Date.now() },
});
assert.equal(ack, "ok", `send should be acknowledged, got ${ack}`);

await new Promise((r) => setTimeout(r, 2000));
assert.equal(got.length, 1, `guardian should receive exactly 1 pin, got ${got.length}`);
assert.equal(got[0].lat, 27.7172);
assert.equal(got[0].lng, 85.324);

console.log("realtime OK — broadcast delivered anon→anon on", TOPIC);
console.log("  payload:", JSON.stringify(got[0]));

await victim.removeChannel(sender);
await guardian.removeChannel(channel);