import { NextResponse } from "next/server";

import { cellAt, scoreOf } from "@/lib/safety";
import { dbConfigured, getCells, supabase } from "@/lib/db";

// Aggregation happens in TS, not SQL: incidents + reports are only a few hundred
// rows, and that avoids an RPC, a view, and a PostGIS dependency. If the row
// count ever reaches six figures, move this to a Postgres group-by.
//
// One dataset serves both audiences — this reads the same tables the routing
// reads, so the dashboard cannot drift from what users actually see.

const WEEKS = 12;
const DAY = 86_400_000;

// Monday 00:00 UTC, so week buckets are stable regardless of who asks.
function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime();
}

export async function GET() {
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });
  const sb = supabase()!;

  const [incidentsRes, reportsRes, { cells }] = await Promise.all([
    sb.from("incidents").select("category,severity,lat,lng,occurred_at").limit(5000),
    sb.from("reports").select("category,lat,lng,created_at,seeded").limit(5000),
    getCells(),
  ]);
  const incidents = incidentsRes.data ?? [];
  const reports = reportsRes.data ?? [];
  const hour = new Date().getHours();

  // attribute every incident/report to its nearest grid cell so the hotspot
  // ranking and the map are talking about the same units
  const counts = new Map<number, { reports: number; seeded: number; incidents: number; severity: number }>();
  const bump = (c: { lat: number; lng: number }, key: "reports" | "incidents") => {
    const id = cellAt(cells, c.lat, c.lng).id;
    const e = counts.get(id) ?? { reports: 0, seeded: 0, incidents: 0, severity: 0 };
    e[key]++;
    counts.set(id, e);
  };
  for (const r of reports) {
    bump(r, "reports");
    if (r.seeded) {
      const id = cellAt(cells, r.lat, r.lng).id;
      counts.get(id)!.seeded++;
    }
  }
  for (const i of incidents) {
    bump(i, "incidents");
    counts.get(cellAt(cells, i.lat, i.lng).id)!.severity += i.severity;
  }

  // worst first: lowest safety score is the most dangerous place
  const top = [...cells]
    .map((c) => {
      const n = counts.get(c.id) ?? { reports: 0, seeded: 0, incidents: 0, severity: 0 };
      return {
        id: c.id,
        lat: c.lat,
        lng: c.lng,
        score: scoreOf(c, hour),
        crimeRisk: c.crimeRisk,
        ...n,
      };
    })
    .sort((a, b) => a.score - b.score || b.incidents - a.incidents)
    .slice(0, 10);

  // weekly series for the trend chart, oldest first
  const now = Date.now();
  const thisWeek = weekStart(now);
  const firstWeek = thisWeek - (WEEKS - 1) * 7 * DAY;
  const weekly = Array.from({ length: WEEKS }, (_, i) => ({
    weekStart: firstWeek + i * 7 * DAY,
    reports: 0,
    incidents: 0,
  }));
  const into = (ms: number) => {
    const idx = Math.floor((weekStart(ms) - firstWeek) / (7 * DAY));
    return idx >= 0 && idx < WEEKS ? idx : -1;
  };
  for (const r of reports) {
    const i = into(Date.parse(r.created_at));
    if (i >= 0) weekly[i].reports++;
  }
  for (const inc of incidents) {
    const i = into(Date.parse(inc.occurred_at));
    if (i >= 0) weekly[i].incidents++;
  }

  const categories: Record<string, number> = {};
  for (const r of reports) categories[r.category] = (categories[r.category] ?? 0) + 1;

  const avgScore = Math.round(
    cells.reduce((sum, c) => sum + scoreOf(c, hour), 0) / (cells.length || 1),
  );

  return NextResponse.json({
    hour,
    stats: {
      cells: cells.length,
      incidents: incidents.length,
      reports: reports.length,
      seededReports: reports.filter((r) => r.seeded).length,
      avgScore,
    },
    top,
    weekly,
    categories,
  });
}