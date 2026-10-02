import { NextRequest, NextResponse } from "next/server";
import { dbConfigured, getCells, invalidateCells, supabase } from "@/lib/db";

const CATEGORIES = ["harassment", "unsafe_spot", "poor_lighting", "stalking", "other"];
const BUMP = 0.15;
const MAX_RISK = 0.9;

export async function POST(req: NextRequest) {
  if (!dbConfigured()) {
    return NextResponse.json({ error: "db not configured" }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const category = body?.category;
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "bad category" }, { status: 400 });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }

  const sb = supabase()!;
  const { error } = await sb.from("reports").insert({
    category,
    lat,
    lng,
    message: typeof body?.message === "string" ? body.message.slice(0, 500) : null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // bump the 3 nearest cells; report_risk itself decays at read time
  const { cells } = await getCells();
  const nearest = [...cells]
    .sort((a, b) => (a.lat - lat) ** 2 + (a.lng - lng) ** 2 - ((b.lat - lat) ** 2 + (b.lng - lng) ** 2))
    .slice(0, 3);
  const now = new Date().toISOString();
  await Promise.all(
    nearest.map((c) =>
      sb
        .from("safety_cells")
        .update({ report_risk: Math.min(MAX_RISK, c.reportRisk + BUMP), report_bumped_at: now })
        .eq("id", c.id),
    ),
  );
  invalidateCells();

  return NextResponse.json({ ok: true, bumped: nearest.length });
}
