"use client";

import { useState } from "react";

import { queueRequest } from "@/lib/offline";
import { scoreColor } from "@/lib/map-style";

const CATEGORIES = [
  { id: "harassment", label: "Harassment" },
  { id: "unsafe_spot", label: "Unsafe spot" },
  { id: "poor_lighting", label: "Poor lighting" },
  { id: "stalking", label: "Stalking" },
  { id: "other", label: "Other" },
];

// Phone photos are 2-5MB; a base64 data URL that size would bloat IndexedDB and
// risk the request body. Downscale with a canvas — no library needed.
async function toSmallJpeg(file: File, max = 800): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

export default function ReportSheet({
  lat,
  lng,
  onClose,
}: {
  lat: number;
  lng: number;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ bumped: number; queued: boolean } | null>(null);

  const submit = async () => {
    if (!category || busy) return;
    setBusy(true);
    const body = { category, lat, lng, message, photo };
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDone({ bumped: (await res.json()).bumped ?? 0, queued: false });
    } catch {
      // no signal or server unreachable: same endpoint, replayed on reconnect
      await queueRequest("/api/report", body);
      setDone({ bumped: 0, queued: true });
    }
    setBusy(false);
  };

  if (done) {
    return (
      <div className="space-y-2 rounded-xl bg-black/80 p-4 backdrop-blur">
        <p className="text-sm font-semibold">
          {done.queued ? "Saved on this phone — sending when you reconnect" : "Thank you — report received"}
        </p>
        {!done.queued && (
          <p className="text-xs text-muted-foreground">
            Safety scores around {lat.toFixed(4)}, {lng.toFixed(4)} just changed for{" "}
            <b style={{ color: scoreColor(50) }}>{done.bumped} nearby {done.bumped === 1 ? "cell" : "cells"}</b>.
            No login, nothing traced to you.
          </p>
        )}
        <button onClick={onClose} className="w-full rounded-xl bg-black/70 px-3 py-3 text-sm">
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl bg-black/80 p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Report an unsafe spot</h2>
        <button onClick={onClose} className="text-sm text-muted-foreground">
          ✕
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Anonymous. No login, no tracking — this is what makes the scores better for everyone.
      </p>
      <p className="font-mono text-xs text-muted-foreground">
        at {lat.toFixed(4)}, {lng.toFixed(4)}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`rounded-lg px-3 py-2 text-xs ${
              category === c.id ? "bg-red-600 text-white" : "bg-black/70 text-muted-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, 500))}
        placeholder="What happened? (optional)"
        rows={2}
        className="w-full resize-none rounded-xl bg-black/70 px-3 py-2 text-sm"
      />

      <div className="flex items-center gap-2">
        <label className="flex-1 cursor-pointer rounded-xl bg-black/70 px-3 py-3 text-center text-sm text-muted-foreground">
          {photo ? "Photo attached ✓" : "Add photo"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void toSmallJpeg(f).then(setPhoto);
            }}
          />
        </label>
        <button
          onClick={submit}
          disabled={!category || busy}
          className="flex-1 rounded-xl bg-red-600 px-3 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Sending…" : "Submit anonymously"}
        </button>
      </div>
    </div>
  );
}