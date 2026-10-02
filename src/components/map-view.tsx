"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map as MLMap,
  Marker,
  GeolocateControl,
  AttributionControl,
  config,
  type MapMouseEvent,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CELLS, scoreOf } from "@/lib/safety";

// Bundlers rewrite import.meta.url, so maplibre can't locate its worker file.
// Serve a copy from /public instead (worker imports ../shared from same dir).
config.WORKER_URL = "/maplibre-gl-worker.mjs";

type Route = {
  id: number;
  duration: number;
  distance: number;
  safety: number;
  coords: [number, number][];
};

type RoutesRes = {
  routes: Route[];
  shortestId: number;
  safestId: number;
  hour: number;
};

type Picked = { lat: number; lng: number };

const CENTER: [number, number] = [85.324, 27.7172]; // Kathmandu demo city
const BRAND = "#1b7a86";

// OSM standard tiles: no API key, no watermark (hackathon demo traffic)
const STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster" as const,
      source: "osm",
      paint: {
        // darken the light basemap so it fits the dark theme
        "raster-brightness-max": 0.42,
        "raster-saturation": -0.55,
        "raster-contrast": 0.18,
      } as Record<string, number>,
    },
  ],
};

const scoreColor = (s: number) => (s >= 70 ? "#22c55e" : s >= 45 ? "#eab308" : "#ef4444");
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
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [data, setData] = useState<RoutesRes | null>(null);
  const [destScore, setDestScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const geo = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    });
    geo.on("geolocate", (e: { coords: { longitude: number; latitude: number } }) =>
      setUserPos([e.coords.longitude, e.coords.latitude]),
    );
    map.addControl(geo, "top-right");
    map.on("click", (e: MapMouseEvent) => {
      setPicked({ lat: +e.lngLat.lat.toFixed(5), lng: +e.lngLat.lng.toFixed(5) });
      setData(null);
      setDestScore(null);
      setError(null);
      setLoading(true);
    });
    map.on("load", () => {
      map.addSource("cells", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: CELLS.map((c) => {
            const score = scoreOf(c, new Date().getHours());
            return {
              type: "Feature" as const,
              properties: { score, risk: (100 - score) / 100 },
              geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
            };
          }),
        },
      });
      map.addLayer({
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
        map.addSource(name, { type: "geojson", data: routeFc() });
        map.addLayer({
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
      setMapReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // fetch score + routes for destination
  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    const origin = userPos ?? CENTER;
    const q = `from=${origin[1]},${origin[0]}&to=${picked.lat},${picked.lng}`;
    Promise.all([
      fetch(`/api/score?lat=${picked.lat}&lng=${picked.lng}`).then((r) => r.json()),
      fetch(`/api/routes?${q}`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
    ])
      .then(([score, routes]) => {
        if (cancelled) return;
        if (score.score !== undefined) setDestScore(score.score);
        if (!routes.ok) setError(routes.j.error ?? "routing failed");
        else setData(routes.j);
      })
      .catch(() => !cancelled && setError("network error"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [picked, userPos]);

  // draw destination marker + route lines
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (markerRef.current) markerRef.current.remove();
    if (picked) {
      markerRef.current = new Marker({ color: BRAND })
        .setLngLat([picked.lng, picked.lat])
        .addTo(map);
    }
    if (data) {
      const byId = (id: number) => data.routes.find((r) => r.id === id);
      (map.getSource("shortest") as GeoJSONSource).setData(routeFc(byId(data.shortestId)));
      (map.getSource("safest") as GeoJSONSource).setData(routeFc(byId(data.safestId)));
    } else {
      (map.getSource("shortest") as GeoJSONSource).setData(routeFc());
      (map.getSource("safest") as GeoJSONSource).setData(routeFc());
    }
  }, [mapReady, picked, data]);

  const shortest = data?.routes.find((r) => r.id === data.shortestId);
  const safest = data?.routes.find((r) => r.id === data.safestId);
  const same = data && data.shortestId === data.safestId;

  return (
    <div className="relative flex-1">
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
        <span className="text-xs text-muted-foreground">tap map → safest route</span>
      </header>

      <div className="absolute bottom-3 left-3 z-10 w-[min(24rem,calc(100vw-1.5rem))] space-y-2">
        {!picked && (
          <div className="rounded-xl bg-black/70 px-4 py-3 text-sm backdrop-blur">
            Tap the map to set your destination.
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
        {same && shortest && <RouteCard r={shortest} label="Best route (safest & shortest)" best />}
        {data && !same && safest && <RouteCard r={safest} label="Safest route" best />}
        {data && !same && shortest && shortest.id !== safest?.id && (
          <RouteCard r={shortest} label="Shortest route" best={false} />
        )}
        {userPos === null && picked && (
          <div className="text-[11px] text-muted-foreground">
            Demo origin: Kathmandu center (enable location for yours)
          </div>
        )}
      </div>
    </div>
  );
}
