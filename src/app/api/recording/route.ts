import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { dbConfigured, supabase } from "@/lib/db";

const BUCKET = "recordings";
// Trust boundary: this is attacker-controlled binary going into a private bucket.
// Complete short recordings stay below both this cap and the hosting upload limit.
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

  const mime = file.type.split(";")[0].toLowerCase();
  const ext = ({ "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav" } as Record<string, string>)[mime];
  if (!ext) return NextResponse.json({ error: "Unsupported audio format" }, { status: 415 });
  const sb = supabase()!;
  const lookup = await sb.from("guardian_sessions").select("media_paths").eq("id", sessionId).maybeSingle();
  if (lookup.error) return NextResponse.json({ error: "Recording session lookup failed" }, { status: 500 });
  if (!lookup.data) return NextResponse.json({ error: "SOS session is not available yet. Recording remains queued." }, { status: 404 });
  const bytes = Buffer.from(await file.arrayBuffer());
  // A retried Blob gets the same private object, including after a lost response.
  const path = `${sessionId}/${createHash("sha256").update(bytes).digest("hex")}.${ext}`;
  const duration = Number(form?.get("durationMs"));

  const up = await sb.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    ...(form?.has("durationMs") && Number.isFinite(duration) && duration >= 0 && duration <= 15 * 60_000 ? { metadata: { durationMs: duration } } : {}),
  });
  if (up.error && String(up.error.statusCode) !== "409") return NextResponse.json({ error: "Recording upload failed. Retry when connected." }, { status: 500 });

  // Compare-and-append preserves other completed segments without a schema/RPC change.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: session, error } = await sb.from("guardian_sessions").select("media_paths").eq("id", sessionId).maybeSingle();
    if (error || !session) break;
    const previous: string[] = session.media_paths ?? [];
    if (previous.includes(path)) return NextResponse.json({ ok: true, path });
    let update = sb.from("guardian_sessions").update({ media_paths: [...previous, path] }).eq("id", sessionId);
    update = session.media_paths === null ? update.is("media_paths", null)
      : update.filter("media_paths", "eq", `{${previous.map(p => JSON.stringify(p)).join(",")}}`);
    const attached = await update.select("id").maybeSingle();
    if (attached.error) break;
    if (attached.data) return NextResponse.json({ ok: true, path });
  }
  return NextResponse.json({ error: "Recording uploaded but could not be attached yet. Retry when connected." }, { status: 500 });
}
