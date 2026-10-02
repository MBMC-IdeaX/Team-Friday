import { NextRequest, NextResponse } from "next/server";
import { getCells } from "@/lib/db";
import { cellAt, scoreOf } from "@/lib/safety";

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }
  const { cells, source } = await getCells();
  const cell = cellAt(cells, lat, lng);
  const hour = new Date().getHours();
  return NextResponse.json({
    score: scoreOf(cell, hour),
    hour,
    source,
    factors: {
      crimeRisk: cell.crimeRisk,
      reportRisk: cell.reportRisk,
      lighting: cell.lighting,
      crowd: cell.crowd,
    },
  });
}
