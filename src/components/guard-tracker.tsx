"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MLMap, Marker, AttributionControl, config } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { CENTER, STYLE } from "@/lib/map-style";
import { joinSession } from "@/lib/realtime";
import { currentPushEnabled, enablePush, pushSupported } from "@/lib/push";

config.WORKER_URL = "/maplibre-gl-worker.mjs";

type Session = {
  id: string;
  status: string;
  triggered_by: string;
  lat: number | null;
  lng: number | null;
  started_at: string;
  media_paths: string[] | null;
};

const POLL_MS = 15_000;

export default function GuardTracker({ id }: { id: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [live, setLive] = useState(false);
  const [age, setAge] = useState(0);
  const [push, setPush] = useState<"unknown" | "on" | "off" | "unsupported">("unknown");
  const [pushNote, setPushNote] = useState<string | null>(null);

  // reload-safety, plus a safety net: if broadcast is blocked by a proxy the
  // persisted pin still moves the marker every POLL_MS. ponytail: one cheap poll
  // beats a dead screen; drop it if realtime proves reliable in the demo.
  useEffect(() => {
    const pull = () =>
      fetch(`/api/sos?id=${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j?.session) return;
          setSession(j.session);
          if (j.session.lat != null && j.session.lng != null) {
            setPin({ lat: j.session.lat, lng: j.session.lng });
          }
        })
        .catch(() => {});
    void pull();
    const t = setInterval(pull, POLL_MS);
    return () => clearInterval(t);
  }, [id]);

  useEffect(
    () => joinSession(id, (p) => { setPin({ lat: p.lat, lng: p.lng }); setLive(true); }).leave,
    [id],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MLMap({
      container: containerRef.current,
      style: STYLE,
      center: CENTER,
      zoom: 13,
      attributionControl: false,
    });
    map.addControl(new AttributionControl({ compact: true }));
    map.on("load", () => setMapReady(true));
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    if (!mapReady || !pin || !mapRef.current) return;
    if (markerRef.current) {
      markerRef.current.setLngLat([pin.lng, pin.lat]);
    } else {
      const el = document.createElement("div");
      el.style.cssText =
        "width:18px;height:18px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 0 12px #ef4444";
      markerRef.current = new Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(mapRef.current);
    }
  }, [mapReady, pin]);

  useEffect(() => {
    void Promise.all([pushSupported(), currentPushEnabled()]).then(([supported, on]) =>
      setPush(!supported ? "unsupported" : on ? "on" : "off"),
    );
  }, []);

  useEffect(() => {
    const t = setInterval(() => setAge((a) => a + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative flex-1">
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      <header className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl bg-black/70 px-3 py-2 backdrop-blur">
        <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-red-500" : "bg-muted-foreground"}`} />
        <span className="text-sm font-semibold">
          {session?.status === "active"
            ? "Tracking live"
            : session
              ? `Session ${session.status}`
              : "Loading…"}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {String(Math.floor(age / 60)).padStart(2, "0")}:{String(age % 60).padStart(2, "0")}
        </span>
      </header>

      <div className="absolute bottom-3 left-3 z-10 w-[min(24rem,calc(100vw-1.5rem))] space-y-1 rounded-xl bg-black/70 px-4 py-3 text-xs backdrop-blur">
        <div className="font-mono">
          {pin ? `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : "no position yet"}
        </div>
        <div className="text-muted-foreground">
          {live ? "live feed" : `polling every ${POLL_MS / 1000}s`}
          {session ? ` · triggered by ${session.triggered_by}` : ""}
        </div>
        <div className="text-muted-foreground">
          {session?.media_paths?.length
            ? `${session.media_paths.length} audio recording${session.media_paths.length === 1 ? "" : "s"} uploaded`
            : "no audio yet"}
        </div>
        <div className="truncate font-mono text-muted-foreground">session: {id}</div>
        <button
          onClick={async () => {
            const r = await enablePush("guardian");
            setPush(r.ok ? "on" : "off");
            setPushNote(r.ok ? "You will be alerted even if this tab is closed." : (r.error ?? null));
          }}
          className="mt-1 w-full rounded-lg bg-red-600/80 px-2 py-1.5 text-xs font-semibold text-white"
        >
          {push === "on" ? "Alerts armed — works with this tab closed" : "Alert me even if this tab is closed"}
        </button>
        {push === "unsupported" && (
          <p className="text-[11px] text-amber-400">
            Push needs a supported browser. On iOS: share sheet → Add to Home Screen, then reopen.
          </p>
        )}
        {pushNote && <p className="text-[11px] text-muted-foreground">{pushNote}</p>}
      </div>
    </div>
  );
}