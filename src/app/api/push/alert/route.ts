import { NextResponse } from "next/server";

import { alertGuardians } from "@/lib/push-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Manual trigger, so the alert path is testable without staging a real SOS.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sessionId = body?.sessionId;
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) {
    return NextResponse.json({ error: "sessionId must be a uuid" }, { status: 400 });
  }
  const sent = await alertGuardians(sessionId, body?.lat ?? null, body?.lng ?? null);
  return NextResponse.json({ ok: true, sent });
}