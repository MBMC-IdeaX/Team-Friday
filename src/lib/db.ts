import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildCells, type Cell } from "./safety";

// Server-only DB access. Falls back to FAKE cells when env is missing or the
// query fails, so the demo never dies (task 1.1 wires Supabase behind this).

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export function dbConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// reports decay with a 7-day half-life-ish: applied at read time, no background jobs
function decayed(risk: number, bumpedAt: string | null): number {
  if (!risk || !bumpedAt) return risk;
  const days = (Date.now() - Date.parse(bumpedAt)) / 86_400_000;
  return risk * Math.exp(-days / 7);
}

const CACHE_MS = 60_000;
let cache: { cells: Cell[]; source: "db" | "fake"; at: number } | null = null;

export async function getCells(signal?: AbortSignal): Promise<{ cells: Cell[]; source: "db" | "fake" }> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const sb = supabase();
  if (!sb) return { cells: buildCells(), source: "fake" };
  const query = sb
    .from("safety_cells")
    .select("id, lat, lng, crime_risk, report_risk, report_bumped_at, lighting, crowd");
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error || !data?.length) {
    console.error("getCells failed, using FAKE:", error?.message);
    return { cells: buildCells(), source: "fake" };
  }
  const cells: Cell[] = data.map((r) => ({
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    crimeRisk: r.crime_risk,
    reportRisk: decayed(r.report_risk, r.report_bumped_at),
    lighting: r.lighting,
    crowd: r.crowd,
  }));
  cache = { cells, source: "db", at: Date.now() };
  return cache;
}

export function invalidateCells(): void {
  cache = null;
}

export { supabase };
