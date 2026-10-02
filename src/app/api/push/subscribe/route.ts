import { NextRequest, NextResponse } from "next/server";

import { dbConfigured, supabase } from "@/lib/db";

// A push subscription is a browser endpoint, not a person. guardianId is our own
// free-form label so one device can carry several guardians' endpoints; it is
// deliberately not a foreign key to any identity table, because linking a push
// endpoint to a verified identity is the exact failure mode PLAN.md §5 argues
// against. See also: no SELECT policy on this table, so the browser can never
// enumerate endpoints.

const isEndpoint = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith("https://") && v.length < 2048;
const isKey = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{20,120}$/.test(v);

export async function POST(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });
  const body = await req.json().catch(() => null);
  if (!isEndpoint(body?.endpoint) || !isKey(body?.p256dh) || !isKey(body?.auth)) {
    return NextResponse.json({ error: "endpoint, p256dh and auth required" }, { status: 400 });
  }
  const guardianId =
    typeof body?.guardianId === "string" ? body.guardianId.slice(0, 64) : null;

  // re-subscribing on the same browser must not create duplicates
  const { error } = await supabase()!
    .from("push_subscriptions")
    .upsert(
      { endpoint: body.endpoint, p256dh: body.p256dh, auth: body.auth, guardian_id: guardianId },
      { onConflict: "endpoint" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  if (!isEndpoint(endpoint)) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }
  await supabase()!.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}

// Lets the guardian page show "armed" without the browser needing read access
// to the table: true when at least one endpoint is registered.
export async function GET() {
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });
  const { count, error } = await supabase()!
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true });
  // NOTE: with head:true, supabase-js swallows a missing-table 404 and hands back
  // { error: null, count: null }. So `count === null` IS the failure signal —
  // without it, "table was never created" reports as a reassuring "0 endpoints".
  if (error || count === null) {
    return NextResponse.json(
      { error: error?.message ?? "push_subscriptions table missing — run the S.6 block in schema.sql" },
      { status: 500 },
    );
  }
  return NextResponse.json({ count });
}