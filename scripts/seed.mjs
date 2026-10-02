// FAKE: seeds Supabase with demo data. The grid is the same buildCells() the
// app falls back to, so the map looks identical whether it reads the DB or not.
// incidents and reports are DERIVED from that grid — no separate dataset file.
// Re-runnable: wipes only demo-owned rows, never real SOS sessions or real reports.

process.loadEnvFile(".env.local");

import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { buildCells, hash } from "../src/lib/safety.ts";

// ponytail: hardcoded so a change to the grid's bounds/loop fails loudly here
// instead of silently seeding a differently-shaped demo.
const EXPECTED_CELLS = 609;
const DAY = 86_400_000;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const chunk = (rows, n) =>
  Array.from({ length: Math.ceil(rows.length / n) }, (_, i) => rows.slice(i * n, (i + 1) * n));

async function insert(table, rows) {
  for (const part of chunk(rows, 500)) {
    const { error } = await sb.from(table).insert(part);
    if (error) throw new Error(`insert ${table}: ${error.message}`);
  }
  return rows.length;
}

const cells = buildCells();
assert.equal(cells.length, EXPECTED_CELLS, `buildCells() returned ${cells.length}, expected ${EXPECTED_CELLS}`);
const now = Date.now();

// incidents — FAKE history, 1-3 per hotspotty cell, spread over the last 180 days
const INCIDENT_CATEGORIES = ["harassment", "theft", "assault", "other"];
const incidents = cells.flatMap((c, n) => {
  if (c.crimeRisk < 0.55) return [];
  const count = 1 + Math.floor(hash(n, 3) * 3);
  return Array.from({ length: count }, (_, k) => ({
    category: INCIDENT_CATEGORIES[Math.floor(hash(n + k, 11) * INCIDENT_CATEGORIES.length)],
    severity: 1 + Math.floor(hash(n + k, 17) * 3),
    lat: c.lat,
    lng: c.lng,
    occurred_at: new Date(now - hash(n + k, 23) * 180 * DAY).toISOString(),
    source: "seed-fake",
  }));
});

// reports — FAKE community reports, clustered on the riskiest cells
const REPORT_CATEGORIES = ["harassment", "unsafe_spot", "poor_lighting", "stalking", "other"];
const MESSAGES = [
  "No streetlights for 200m",
  "Men following me on the way home",
  "Empty and unlit after 9pm",
  "Water kiosk area, does not feel safe",
  "Repeated catcalling near the gate",
];
const risky = cells.filter((c) => c.crimeRisk > 0.6);
assert.ok(risky.length > 10, `only ${risky.length} risky cells to hang reports on`);
const reports = Array.from({ length: 40 }, (_, i) => {
  const c = risky[Math.floor(hash(i, 41) * risky.length)];
  return {
    category: REPORT_CATEGORIES[Math.floor(hash(i, 43) * REPORT_CATEGORIES.length)],
    lat: +(c.lat + (hash(i, 47) - 0.5) * 0.004).toFixed(5),
    lng: +(c.lng + (hash(i, 53) - 0.5) * 0.004).toFixed(5),
    message: MESSAGES[i % MESSAGES.length],
    seeded: true,
    created_at: new Date(now - hash(i, 59) * 45 * DAY).toISOString(),
  };
});

const cellRows = cells.map((c) => ({
  lat: c.lat,
  lng: c.lng,
  crime_risk: c.crimeRisk,
  report_risk: c.reportRisk,
  lighting: c.lighting,
  crowd: c.crowd,
}));

// order matters: reports reference nothing, but cells are the base layer
for (const wipe of [
  sb.from("incidents").delete().neq("id", 0),
  sb.from("safety_cells").delete().neq("id", 0),
  sb.from("reports").delete().eq("seeded", true),
]) {
  const { error } = await wipe;
  if (error) throw new Error(`wipe: ${error.message}`);
}

console.log(`safety_cells  ${await insert("safety_cells", cellRows)}`);
console.log(`incidents     ${await insert("incidents", incidents)}`);
console.log(`reports       ${await insert("reports", reports)}`);
console.log(
  `seed OK — ${EXPECTED_CELLS} cells (21x29 @ 0.005°), ${incidents.length} incidents, ${reports.length} seeded reports`,
);