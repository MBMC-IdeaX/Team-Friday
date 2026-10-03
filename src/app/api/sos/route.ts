import { after, NextRequest, NextResponse } from "next/server";

import { dbConfigured, supabase } from "@/lib/db";
import { alertGuardians } from "@/lib/push-server";

// The client generates the session uuid BEFORE it knows whether the network is
// up, so the guardian link works offline and stays identical once the queued
// insert lands. That means the uuid is the capability: anyone holding the link
// can move the pin — same trust model as the guardian URL itself.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRIGGERS = ["tap", "voice"];
const STATUSES = ["active", "ended", "resolved"];

const coord = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function POST(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });
  const body = await req.json().catch(() => null);
  const id = body?.id;
  const lat = coord(body?.lat);
  const lng = coord(body?.lng);
  if (typeof id !== "string" || !UUID.test(id)) {
    return NextResponse.json({ error: "id must be a uuid" }, { status: 400 });
  }
  if (!TRIGGERS.includes(body?.triggered_by)) {
    return NextResponse.json({ error: "triggered_by must be tap or voice" }, { status: 400 });
  }
  if (lat === null || lng === null) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }

  const { data: created, error } = await supabase()!.rpc("persist_sos_initial", {
    p_id: id, p_triggered_by: body.triggered_by, p_lat: lat, p_lng: lng,
  });
  if (error || typeof created !== "boolean") {
    return NextResponse.json({ error: "Could not persist SOS" }, { status: 500 });
  }

  // Persist first; Next keeps this attempt alive after the response.
  if (created) after(async () => {
    try {
      const accepted = await alertGuardians(id);
      console.info("Initial SOS push attempt completed; provider-accepted sends:", accepted);
    } catch {
      console.error("Initial SOS push attempt failed; SOS remains persisted.");
    }
  });
  return NextResponse.json({ ok: true, id, created, pushScheduled: created });
}

export async function PATCH(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !UUID.test(id)) {
    return NextResponse.json({ error: "id must be a uuid" }, { status: 400 });
  }

  if (body?.status === "resolved" || body?.status === "ended") {
    const { error } = await supabase()!.rpc("persist_sos_terminal", {
      p_id: id, p_status: body.status,
    });
    if (error) return NextResponse.json({ error: "Could not persist terminal state" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Pins are deliberately NOT queued. A stale pin is worse than none — it puts
  // her in the wrong place. The next watchPosition tick retries on its own once
  // the network returns, so it self-heals within one interval.
  const patch: Record<string, unknown> = {};
  const lat = coord(body?.lat);
  const lng = coord(body?.lng);
  if (lat !== null && lng !== null) {
    patch.lat = lat;
    patch.lng = lng;
  }
  if (STATUSES.includes(body?.status)) patch.status = body.status;
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase()!
    .from("guardian_sessions")
    .update(patch)
    .eq("id", id).eq("status", "active").select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Active session not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// reload-safety: the guardian page reads the last persisted pin so a refresh
// (or arriving from the push notification) is not a blank map.
export async function GET(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !UUID.test(id)) {
    return NextResponse.json({ error: "id must be a uuid" }, { status: 400 });
  }
  const { data, error } = await supabase()!
    .from("guardian_sessions")
    .select("id,status,triggered_by,lat,lng,started_at,media_paths")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "session not found" }, { status: 404 });
  return NextResponse.json({ session: data });
}