import { NextRequest, NextResponse } from "next/server";

import { dbConfigured, getCells, invalidateCells, supabase } from "@/lib/db";

const CATEGORIES = ["harassment", "unsafe_spot", "poor_lighting", "stalking", "other"];
const BUMP = 0.15;
const MAX_RISK = 0.9;

// The client downscales to ~800px JPEG before sending, so a data URL is small
// enough to keep in IndexedDB and replay offline. This cap is the trust boundary
// — a data URL is attacker-controlled and would otherwise be an upload of any
// size to a private bucket.
const MAX_PHOTO_BYTES = 512 * 1024;
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,/;

function decodePhoto(dataUrl: string): { bytes: Buffer; mime: string } | null {
  const m = PHOTO_RE.exec(dataUrl);
  if (!m) return null;
  const bytes = Buffer.from(dataUrl.slice(m[0].length), "base64");
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return null;
  return { bytes, mime: `image/${m[1]}` };
}
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
  const photo = typeof body?.photo === "string" ? decodePhoto(body.photo) : null;
  // Plan the object path up front so the report row can reference it before the
  // upload is attempted. If the upload fails we clear media_path rather than
  // lose the report — the report is the valuable part.
  const path = photo ? `${crypto.randomUUID()}.${photo.mime === "image/jpeg" ? "jpg" : photo.mime.split("/")[1]}` : null;

  const { error } = await sb.from("reports").insert({
    category,
    lat,
    lng,
    message: typeof body?.message === "string" ? body.message.slice(0, 500) : null,
    media_path: path,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let photoSaved = false;
  if (photo && path) {
    const up = await sb.storage.from("report-photos").upload(path, photo.bytes, {
      contentType: photo.mime,
    });
    if (up.error) {
      await sb.from("reports").update({ media_path: null }).like("media_path", path);
    } else {
      photoSaved = true;
    }
  }

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

  return NextResponse.json({ ok: true, bumped: nearest.length, photo: photoSaved });
}
