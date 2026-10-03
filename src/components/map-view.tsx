"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Map as MLMap,
  Marker,
  AttributionControl,
  config,
  type MapMouseEvent,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { buildCells, scoreOf, type Cell } from "@/lib/safety";

// Bundlers rewrite import.meta.url, so maplibre can't locate its worker file.
// Serve a copy from /public instead (worker imports ../shared from same dir).
config.WORKER_URL = "/maplibre-gl-worker.mjs";

type Picked = { lat: number; lng: number };

import PlaceSearch from "@/components/place-search";
import ReportSheet from "@/components/report-sheet";
import { startVoiceSos, voiceSupported } from "@/lib/voice";
import { activeSessionId, endSosSession } from "@/lib/offline";
import { BRAND, CENTER, STYLE, scoreColor } from "@/lib/map-style";

import { navigateTo } from "@/lib/navigation";
import { fetchJson } from "@/lib/network";
import { watchDeviceLocation, routingOrigin, type DeviceLocation } from "@/lib/location";
import { readSafetyCache, saveSafetyCache, validSafetyData, loadRoute, readLastJourney, type Route, type RoutesRes } from "@/lib/map-cache";

const fmtTime = (sec: number) => `${Math.round(sec / 60)} min`;
const fmtDist = (m: number) => `${(m / 1000).toFixed(1)} km`;
const routeFc = (r?: Route) => ({
  type: "Feature" as const,
  properties: {},
  geometry: { type: "LineString" as const, coordinates: r ? r.coords : [] },
});

function RouteCard({ r, label, best }: { r: Route; label: string; best: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        best ? "border-[#1b7a86] bg-[#1b7a86]/10" : "border-white/10 bg-black/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {best && (
          <span className="rounded-full bg-[#1b7a86] px-2 py-0.5 text-[11px] font-semibold text-white">
            Recommended
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-3 text-sm text-muted-foreground">
        <span>
          Safety{" "}
          <b style={{ color: scoreColor(r.safety) }} className="text-base">
            {r.safety}
          </b>
          /100
        </span>
        <span>{fmtTime(r.duration)}</span>
        <span>{fmtDist(r.distance)}</span>
      </div>
    </div>
  );
}

export default function MapView() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const centeredRef = useRef(false);
  const [mapReady, setMapReady] = useState(0);
  const [picked, setPicked] = useState<Picked | null>(null);
  const pickedRef = useRef<Picked | null>(null);
  const [origin, setOrigin] = useState<Picked | null>(null);
  const [locationAttempt, setLocationAttempt] = useState(0);
  const [fix, setFix] = useState<DeviceLocation | null>(null);
  const [locationNote, setLocationNote] = useState("Waiting for device location. The initial map center is not your position.");
  const [savedJourney, setSavedJourney] = useState<Awaited<ReturnType<typeof readLastJourney>>>(null);
  const [routeNote, setRouteNote] = useState<string | null>(null);
  const [data, setData] = useState<RoutesRes | null>(null);
  const [destScore, setDestScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [cellsNote, setCellsNote] = useState<string | null>(null);
  const [scoreHour, setScoreHour] = useState(() => new Date().getHours());
  const [reporting, setReporting] = useState(false);
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<string | null>(null);

  const pickDestination = useCallback((next: Picked) => {
    if (pickedRef.current?.lat === next.lat && pickedRef.current.lng === next.lng) return;
    setSavedJourney(null);
    pickedRef.current = next;
    setPicked(next);
    setData(null);
    setDestScore(null);
    setError(null);
    setLoading(true);
  }, []);

  // Voice SOS. Arms only from a click, because Web Speech will not start without a
  // gesture. On a match it just routes into /sos — every reliability property
  // already lives there (local-first write, tel:, recording, guardians).
  const stopVoiceRef = useRef<(() => void) | null>(null);
  const toggleVoice = () => {
    if (voiceArmed) {
      stopVoiceRef.current?.();
      stopVoiceRef.current = null;
      setVoiceArmed(false);
      setVoiceNote(null);
      return;
    }
    if (!voiceSupported()) {
      setVoiceNote("This browser has no speech recognition.");
      return;
    }
    stopVoiceRef.current = startVoiceSos(
      () => navigateTo("/sos", router),
      (message) => {
        setVoiceNote(message);
        setVoiceArmed(false);
      },
    );
    setVoiceArmed(true);
    setVoiceNote('Say "help me" or "bachao". Needs a network connection.');
  };
  useEffect(() => () => stopVoiceRef.current?.(), []);

  // An SOS is a toggle: tapping again stops the alert. localStorage is read
  // directly rather than via state so the very first paint already shows the
  // right button — no flash of "SOS" on top of a live session.
  useEffect(() => {
    const read = () => setActiveSession(activeSessionId());
    read();
    addEventListener("focus", read);
    return () => removeEventListener("focus", read);
  }, []);

  const endSession = async () => {
    const id = activeSessionId();
    if (!id) return;
    try {
      await endSosSession(id);
      setActiveSession(null);
    } catch {
      alert("Could not save the end request. Please try again.");
    }
  };

  // init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MLMap({
      container: containerRef.current,
      style: STYLE,
      center: CENTER,
      zoom: 12,
      attributionControl: false,
    });
    map.addControl(new AttributionControl({ compact: true }), "top-right");
    mapRef.current = map;
    map.on("click", (e: MapMouseEvent) => {
      pickDestination({ lat: +e.lngLat.lat.toFixed(5), lng: +e.lngLat.lng.toFixed(5) });
    });
    // style.load permits adding sources/layers without waiting for raster tiles.
    map.on("style.load", () => {
      if (!map.getSource("cells")) map.addSource("cells", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      if (!map.getLayer("cells")) map.addLayer({
        id: "cells",
        type: "circle",
        source: "cells",
        paint: {
          "circle-radius": 18,
          "circle-opacity": 0.32,
          "circle-color": [
            "step",
            ["get", "risk"],
            BRAND,
            0.35,
            "#eab308",
            0.58,
            "#ef4444",
          ],
        },
      });
      for (const name of ["shortest", "safest"] as const) {
        if (!map.getSource(name)) map.addSource(name, { type: "geojson", data: routeFc() });
        if (!map.getLayer(name)) map.addLayer({
          id: name,
          type: "line",
          source: name,
          paint: {
            "line-color": name === "safest" ? BRAND : "#94a3b8",
            "line-width": name === "safest" ? 5 : 3,
            "line-dasharray": name === "safest" ? [1, 0] : [2, 2],
          },
        });
      }
      setMapReady((version) => version + 1);
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(containerRef.current);
    return () => {
      resize.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [pickDestination]);

  // Only device fixes enter live position state; the initial camera center is visual.
  useEffect(() => watchDeviceLocation((position) => {
    setFix(position);
    setLocationNote(`Device location · accuracy ±${Math.round(position.accuracy)} m`);
  }, (message) => { setFix(null); setLocationNote(message); }), [locationAttempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!fix) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }
    const point: [number, number] = [fix.lng, fix.lat];
    if (userMarkerRef.current) userMarkerRef.current.setLngLat(point);
    else userMarkerRef.current = new Marker({ color: "#38bdf8" }).setLngLat(point).addTo(map);
    if (!centeredRef.current) {
      map.jumpTo({ center: point, zoom: 14 });
      centeredRef.current = true;
    }
  }, [fix, mapReady]);

  // Render saved data first, then refresh online. Invalid replies never replace it.
  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const saved = await readSafetyCache();
      const apply = (value: { cells: Cell[]; source: "db" | "fake" }, note: string | null) => {
        if (cancelled || request !== controller) return;
        setCells(value.cells); setCellsNote(value.source === "fake" ? `${note ?? "Database unavailable or unconfigured."} Synthetic demo safety data.` : note);
      };
      if (saved) apply(saved.value, `Saved safety data · ${new Date(saved.savedAt).toLocaleString()}. Factors may be outdated.`);
      const timeout = setTimeout(() => request.abort(), 8_000);
      try {
        if (!navigator.onLine) throw new Error("Offline");
        const response = await fetch("/api/cells", { signal: request.signal, cache: "no-store" });
        const value: unknown = response.ok ? await response.json() : null;
        if (!validSafetyData(value)) throw new Error("Invalid safety data");
        if (value.source === "fake" && saved?.value.source === "db") throw new Error("Database unavailable");
        const cachedResponse = response.headers.get("X-HG-Safety-Cache") === "1";
        if (!cachedResponse || !saved) await saveSafetyCache(value);
        if (cachedResponse) {
          apply(saved?.value ?? value, "Saved safety data: network refresh unavailable. Factors may be outdated.");
          return;
        }
        apply(value, value.source === "fake" ? "Database unavailable or unconfigured." : null);
      } catch {
        if (!saved) {
          // FAKE: explicitly identified fallback when no valid saved factors exist.
          apply({ cells: buildCells(), source: "fake" }, "No saved safety dataset.");
        }
      } finally { clearTimeout(timeout); }
    };
    void load();
    addEventListener("online", load);
    return () => { cancelled = true; controller?.abort(); removeEventListener("online", load); };
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setScoreHour(new Date().getHours()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // Routing may use a deliberately selected start, never a demo/GPS fallback.
  const routeOrigin = routingOrigin(origin, fix);
  const fromLat = routeOrigin?.lat;
  const fromLng = routeOrigin?.lng;
  const toLat = picked?.lat;
  const toLng = picked?.lng;

  useEffect(() => {
    if (toLat === undefined || toLng === undefined) return;
    let cancelled = false;
    let revision = 0;
    const controller = new AbortController();
    const load = async () => {
      const attempt = ++revision;
      setLoading(true); setError(null); setData(null); setDestScore(null); setRouteNote(null);
      if (fromLat === undefined || fromLng === undefined) {
        setError("Location unavailable. Enable location or choose a start point to get a route.");
        setLoading(false); return;
      }
      try {
        if (savedJourney && savedJourney.from.lat === fromLat && savedJourney.from.lng === fromLng && savedJourney.to.lat === toLat && savedJourney.to.lng === toLng) {
          setData(savedJourney.value);
          setRouteNote(`Saved journey · ${new Date(savedJourney.savedAt).toLocaleString()}. Original start: ${fromLat}, ${fromLng}; not your live GPS start. Route and scores may be outdated.`);
          return;
        }
        const result = await loadRoute({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }, controller.signal);
        if (cancelled || attempt !== revision) return;
        setData(result.value);
        setRouteNote(result.cached ? `Saved route · ${new Date(result.savedAt).toLocaleString()}. Route and scores may be outdated; basemap tiles and place search need internet.` : null);
        // Destination scoring failure must not discard an otherwise usable route.
        if (!result.cached) {
          void fetchJson<{ score?: number }>(`/api/score?lat=${toLat}&lng=${toLng}`, { signal: controller.signal })
            .then(({ response, data }) => response.ok ? data : null)
            .then((j) => { if (!cancelled && attempt === revision && typeof j?.score === "number") setDestScore(j.score); })
            .catch(() => {});
        }
      } catch (err) {
        if (!cancelled && attempt === revision) setError(err instanceof Error ? err.message : "Routing unavailable. Try again online.");
      } finally { if (!cancelled && attempt === revision) setLoading(false); }
    };
    const retry = () => { if (!controller.signal.aborted) void load(); };
    void load();
    addEventListener("online", retry);
    addEventListener("offline", retry);
    return () => { cancelled = true; controller.abort(); removeEventListener("online", retry); removeEventListener("offline", retry); };
  }, [toLat, toLng, fromLat, fromLng, savedJourney]);

  // Destination changes do not rebuild the safety grid or route geometry.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (picked) {
      if (markerRef.current) markerRef.current.setLngLat([picked.lng, picked.lat]);
      else markerRef.current = new Marker({ color: BRAND }).setLngLat([picked.lng, picked.lat]).addTo(map);
    } else {
      markerRef.current?.remove();
      markerRef.current = null;
    }
  }, [mapReady, picked]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (cells.length) {
      (map.getSource("cells") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: cells.map((c) => {
          const score = scoreOf(c, scoreHour);
          return {
            type: "Feature" as const,
            properties: { score, risk: (100 - score) / 100 },
            geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
          };
        }),
      });
    }
  }, [mapReady, cells, scoreHour]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (data) {
      const byId = (id: number) => data.routes.find((r) => r.id === id);
      (map.getSource("shortest") as GeoJSONSource | undefined)?.setData(routeFc(byId(data.shortestId)));
      (map.getSource("safest") as GeoJSONSource | undefined)?.setData(routeFc(byId(data.safestId)));
    } else {
      (map.getSource("shortest") as GeoJSONSource | undefined)?.setData(routeFc());
      (map.getSource("safest") as GeoJSONSource | undefined)?.setData(routeFc());
    }
  }, [mapReady, data]);

  const shortest = data?.routes.find((r) => r.id === data.shortestId);
  const safest = data?.routes.find((r) => r.id === data.safestId);
  const same = data && data.shortestId === data.safestId;

  return (
    <div className="relative min-h-0 flex-1">
      {/* maplibre's unlayered CSS forces position:relative on .maplibregl-map (beats
          Tailwind layers), and % heights don't resolve against the flex parent —
          inline absolute+inset stretches against the parent's used height instead */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      <header className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl bg-black/70 px-3 py-2 backdrop-blur">
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          <path d="M12 2l8 3.5v6c0 5-3.4 9.3-8 10.5-4.6-1.2-8-5.5-8-10.5v-6L12 2z" fill={BRAND} />
          <path d="M8.5 12l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.8" fill="none" />
        </svg>
        <span className="font-semibold">HerGuardian</span>
        <button
          onClick={() => navigateTo("/login", router)}
          className="-my-2 rounded-lg px-2 py-2 text-xs text-muted-foreground underline"
        >
          sign in (optional)
        </button>
      </header>

      <div className="absolute bottom-3 left-3 z-10 w-[min(24rem,calc(100vw-1.5rem))] space-y-2">
        {cellsNote && (
          <p role="status" className="rounded-xl bg-black/80 px-3 py-2 text-xs text-amber-300">
            {cellsNote}
          </p>
        )}
        <p role="status" className="rounded-xl bg-black/80 px-3 py-2 text-xs text-muted-foreground">
          {locationNote}{" "}
          <button className="underline" onClick={() => {
            centeredRef.current = false; setFix(null);
            setLocationNote("Waiting for a fresh device location.");
            setLocationAttempt(value => value + 1);
          }}>Retry GPS</button>
        </p>
        {fix && cells.length > 0 && !cells.some(c => Math.abs(c.lat - fix.lat) < 0.006 && Math.abs(c.lng - fix.lng) < 0.006) && (
          <p role="status" className="rounded-xl bg-black/80 px-3 py-2 text-xs text-amber-300">No safety-cell coverage near your location. Available dots cover the Kathmandu dataset only.</p>
        )}
        <button className="text-xs underline" onClick={async () => {
          const journey = await readLastJourney();
          if (!journey) { setError("No saved journey is available. Generate a route online first."); return; }
          pickedRef.current = journey.to;
          setPicked(journey.to); setOrigin(journey.from); setSavedJourney(journey);
          centeredRef.current = true;
          setError(null); setDestScore(null);
          const coords = journey.value.routes.flatMap(route => route.coords);
          if (coords.length && mapRef.current) {
            const bounds = coords.reduce((box, [lng, lat]) => [Math.min(box[0], lng), Math.min(box[1], lat), Math.max(box[2], lng), Math.max(box[3], lat)], [Infinity, Infinity, -Infinity, -Infinity]);
            mapRef.current.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 50, duration: 0 });
          }
        }}>Reopen last saved journey</button>
        <div className="space-y-1.5">
          <PlaceSearch
            placeholder="Go to (e.g. Ring Road, Thamel)"
            onPick={(r) => pickDestination({ lat: r.lat, lng: r.lng })}
          />
          <PlaceSearch
            placeholder="Start from (defaults to you)"
            onPick={(r) => { setSavedJourney(null); setOrigin({ lat: r.lat, lng: r.lng }); }}
          />
          {origin && (
            <button
              onClick={() => { setSavedJourney(null); setOrigin(null); }}
              className="w-full rounded-lg bg-black/70 px-2 py-1.5 text-[11px] text-muted-foreground"
            >
              Using a fixed start point · tap to go back to your location
            </button>
          )}
        </div>
        <button
          onClick={() => (activeSession ? endSession() : navigateTo("/sos", router))}
          className={`w-full rounded-xl py-4 text-center text-lg font-bold tracking-wide text-white ${
            activeSession ? "bg-red-950 text-red-300 ring-1 ring-red-500/50" : "bg-red-600"
          }`}
        >
          {activeSession ? "STOP ALERT" : "SOS"}
        </button>
        {activeSession && (
          <button
            onClick={endSession}
            className="w-full rounded-xl border border-emerald-500/40 bg-emerald-950/60 px-3 py-3 text-center text-sm font-semibold text-emerald-300"
          >
            I&apos;m safe — end this session
          </button>
        )}
        <div className="flex gap-2">
          <button
            onClick={toggleVoice}
            className={`flex-1 rounded-xl px-3 py-3 text-sm backdrop-blur ${
              voiceArmed ? "bg-red-600 text-white" : "bg-black/70"
            }`}
          >
            {voiceArmed ? "🎙 Voice SOS armed" : "🎙 Voice SOS"}
          </button>
          <button
            onClick={() => picked || fix ? setReporting(true) : setError("Enable location or select a spot on the map before reporting.")}
            className="flex-1 rounded-xl bg-black/70 px-3 py-3 text-sm backdrop-blur"
          >
            Report a spot
          </button>
          <button
            onClick={() => navigateTo("/dashboard", router)}
            className="flex-1 rounded-xl bg-black/70 px-3 py-3 text-sm backdrop-blur"
          >
            Authority view
          </button>
        </div>
        {reporting && (picked || fix) && (
          <ReportSheet
            lat={picked?.lat ?? fix!.lat}
            lng={picked?.lng ?? fix!.lng}
            onClose={() => setReporting(false)}
          />
        )}
        {voiceNote && (
          <div className="rounded-xl bg-black/70 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
            {voiceNote}
          </div>
        )}
        {!picked && (
          <div className="rounded-xl bg-black/70 px-4 py-3 text-sm backdrop-blur">
            Search above, or tap the map to set your destination.
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-950/80 px-4 py-3 text-sm backdrop-blur">
            {error}
          </div>
        )}
        {loading && (
          <div className="rounded-xl bg-black/70 px-4 py-3 text-sm backdrop-blur">
            Scoring routes…
          </div>
        )}
        {destScore !== null && picked && (
          <div className="flex items-center gap-2 rounded-xl bg-black/70 px-4 py-3 text-sm backdrop-blur">
            Destination safety score:
            <b style={{ color: scoreColor(destScore) }} className="text-base">
              {destScore}
            </b>
            /100
          </div>
        )}
        {routeNote && <p role="status" className="rounded-xl bg-black/80 px-3 py-2 text-xs text-amber-300">{routeNote}</p>}
        {same && shortest && <RouteCard r={shortest} label="Best route (safest & shortest)" best />}
        {data && !same && safest && <RouteCard r={safest} label="Safest route" best />}
        {data && !same && shortest && shortest.id !== safest?.id && (
          <RouteCard r={shortest} label="Shortest route" best={false} />
        )}
      </div>
    </div>
  );
}
