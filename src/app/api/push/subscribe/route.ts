import { NextRequest, NextResponse } from "next/server";
import { dbConfigured, supabase } from "@/lib/db";
import { isPushEndpoint, isPushKey, isSessionId } from "@/lib/push-contract";

export async function POST(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });
  const body = await req.json().catch(() => null);
  if (!isPushEndpoint(body?.endpoint) || !isPushKey(body?.p256dh, "p256dh") ||
      !isPushKey(body?.auth, "auth") || !isSessionId(body?.sessionId)) {
    return NextResponse.json({ error: "valid endpoint, p256dh, auth and sessionId required" }, { status: 400 });
  }
  const sb = supabase()!;
  const session = await sb.from("guardian_sessions").select("id").eq("id", body.sessionId).maybeSingle();
  if (session.error) return NextResponse.json({ error: "Session lookup failed" }, { status: 500 });
  if (!session.data) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  // The RPC stores endpoint and association in one transaction.
  const { error } = await sb.rpc("subscribe_push_session", {
    p_endpoint: body.endpoint, p_p256dh: body.p256dh, p_auth: body.auth, p_session_id: body.sessionId,
  });
  if (error) return NextResponse.json({ error: "Could not store session subscription" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function parameters(req: NextRequest) {
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  return isPushEndpoint(endpoint) && isSessionId(sessionId) ? { endpoint, sessionId } : null;
}

export async function GET(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });
  const input = parameters(req);
  if (!input) return NextResponse.json({ error: "valid endpoint and sessionId required" }, { status: 400 });
  const { data, error } = await supabase()!.from("push_subscription_sessions")
    .select("session_id,push_subscriptions!inner(endpoint)")
    .eq("session_id", input.sessionId).eq("push_subscriptions.endpoint", input.endpoint).maybeSingle();
  if (error) return NextResponse.json({ error: "Subscription lookup failed" }, { status: 500 });
  return NextResponse.json({ armed: !!data }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });
  const input = parameters(req);
  if (!input) return NextResponse.json({ error: "valid endpoint and sessionId required" }, { status: 400 });
  const { error } = await supabase()!.rpc("unsubscribe_push_session", {
    p_endpoint: input.endpoint, p_session_id: input.sessionId,
  });
  if (error) return NextResponse.json({ error: "Could not remove session subscription" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
