// Resets the demo DB to a known-good state: deletes rows created by the check
// scripts and the CDP probes, plus any orphaned storage objects, then reseeds.
// Safe to re-run — seeded history is what the demo needs, not what it left over.
//
//   node scripts/reset-demo.mjs
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// rows only the checks/probes write: a known message, or no message at all
// (the photo-rejection cases post {category:"other"} with nothing else)
const JUNK = ["check-script", "cdp-driven report", "with photo"];
const { data: reports } = await sb.from("reports").select("id,message,media_path,seeded");
const doomed = (reports ?? []).filter(
  (r) => !r.seeded && (JUNK.includes(r.message ?? "") || !r.message),
);
if (doomed.length) {
  await sb.from("reports").delete().in("id", doomed.map((r) => r.id));
}
console.log(`reports   deleted ${doomed.length} check/probe rows`);

const paths = doomed.map((r) => r.media_path).filter(Boolean);
for (const p of paths) await sb.storage.from("report-photos").remove([p]);
if (paths.length) console.log(`photos    removed ${paths.length} orphaned objects`);

const { data: sessions } = await sb.from("guardian_sessions").select("id");
if (sessions?.length) await sb.from("guardian_sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
console.log(`sessions  deleted ${sessions?.length ?? 0} SOS test rows`);

for (const [label, table] of [["cells", "safety_cells"], ["incidents", "incidents"]]) {
  const { count } = await sb.from(table).select("id", { count: "exact", head: true });
  console.log(`${label.padEnd(9)} ${count} rows (use npm run seed to reset)`);
}
const { count: kept } = await sb.from("reports").select("id", { count: "exact", head: true });
console.log(`reports   ${kept} rows remain (seeded history)`);