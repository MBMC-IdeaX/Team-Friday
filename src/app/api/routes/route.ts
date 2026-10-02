import { NextRequest, NextResponse } from "next/server";
import { getCells } from "@/lib/db";
import { safetyAt } from "@/lib/safety";

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
};

function routeSafety(
  cells: Awaited<ReturnType<typeof getCells>>["cells"],
  coords: [number, number][],
  hour: number,
): number {
  const step = Math.max(1, Math.floor(coords.length / 60)); // sample ~60 points
  let sum = 0;
  let n = 0;
  for (let i = 0; i < coords.length; i += step) {
    const [lng, lat] = coords[i];
    sum += safetyAt(cells, lat, lng, hour);
    n++;
  }
  return Math.round(sum / n);
}

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from"); // "lat,lng"
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }
  const fmt = (s: string) => {
    const [lat, lng] = s.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return `${lng},${lat}`;
  };
  const o = fmt(from);
  const d = fmt(to);
  if (!o || !d) {
    return NextResponse.json({ error: "expected lat,lng" }, { status: 400 });
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${o};${d}?alternatives=true&overview=full&geometries=geojson`;
  let data: { routes?: OsrmRoute[]; code?: string };
  try {
    const res = await fetch(url);
    data = await res.json();
  } catch {
    return NextResponse.json({ error: "routing service unreachable" }, { status: 502 });
  }
  if (!data.routes?.length) {
    return NextResponse.json(
      { error: `no routes found (OSRM: ${data.code ?? "error"})` },
      { status: 502 },
    );
  }

  const { cells } = await getCells();
  const hour = new Date().getHours();
  const routes = data.routes.map((r, i) => ({
    id: i,
    duration: Math.round(r.duration),
    distance: Math.round(r.distance),
    safety: routeSafety(cells, r.geometry.coordinates, hour),
    coords: r.geometry.coordinates,
  }));

  const shortest = [...routes].sort((a, b) => a.duration - b.duration)[0];
  const safest = [...routes].sort((a, b) => b.safety - a.safety)[0];

  return NextResponse.json({ routes, shortestId: shortest.id, safestId: safest.id, hour });
}
