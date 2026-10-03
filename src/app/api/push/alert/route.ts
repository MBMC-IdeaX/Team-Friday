import { NextResponse } from "next/server";

import { dbConfigured, supabase } from "@/lib/db";
import { isSessionId } from "@/lib/push-contract";
import { alertGuardians } from "@/lib/push-server";

// Development helper only; production SOS delivery runs through /api/sos.
export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });
  const body = await req.json().catch(() => null);
  if (!isSessionId(body?.sessionId)) {
    return NextResponse.json({ error: "sessionId must be a uuid" }, { status: 400 });
  }
  const { data, error } = await supabase()!.from("guardian_sessions")
    .select("id").eq("id", body.sessionId).maybeSingle();
  if (error) return NextResponse.json({ error: "Session lookup failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  try {
    const sent = await alertGuardians(data.id);
    return NextResponse.json({ ok: true, sent });
  } catch {
    return NextResponse.json({ error: "Push attempt failed" }, { status: 503 });
  }
}
