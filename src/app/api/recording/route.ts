import { NextRequest, NextResponse } from "next/server";

import { dbConfigured, supabase } from "@/lib/db";

const BUCKET = "recordings";
// Trust boundary: this is attacker-controlled binary going into a private bucket.
// getUserMedia hands us a few KB per 10s chunk, so anything large is not a chunk.
const MAX_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({ error: "db not configured" }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const sessionId = form?.get("sessionId");
  const file = form?.get("file");
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) {
    return NextResponse.json({ error: "sessionId must be a uuid" }, { status: 400 });
  }
  if (!(file instanceof Blob) || !file.size) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "chunk too large" }, { status: 413 });
  }

  const sb = supabase()!;
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = file.type.includes("mp4") ? "mp4" : "webm";
  const path = `${sessionId}/${Date.now()}.${ext}`;

  const up = await sb.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type || `audio/${ext}`,
  });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  // Append rather than replace: chunks arrive over time and the array is what the
  // guardian view counts. A read-modify-write race just loses a chunk in a demo.
  const { data: session } = await sb
    .from("guardian_sessions")
    .select("media_paths")
    .eq("id", sessionId)
    .maybeSingle();
  if (session) {
    await sb
      .from("guardian_sessions")
      .update({ media_paths: [...(session.media_paths ?? []), path] })
      .eq("id", sessionId);
  }

  return NextResponse.json({ ok: true, path });
}