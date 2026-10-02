"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Map as MLMap, Marker, NavigationControl, config, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { BRAND, CENTER, STYLE, scoreColor } from "@/lib/map-style";
import { buildCells, scoreOf, type Cell } from "@/lib/safety";

config.WORKER_URL = "/maplibre-gl-worker.mjs";

type Top = {
  id: number;
  lat: number;
  lng: number;
  score: number;
  crimeRisk: number;
  reports: number;
  seeded: number;
  incidents: number;
  severity: number;
};
type Weekly = { weekStart: number; reports: number; incidents: number };
type Dash = {
  hour: number;
  stats: {
    cells: number;
    incidents: number;
    reports: number;
    seededReports: number;
    avgScore: number;
    avgScoreWithoutReports: number;
  };
  biggestSwing: null | {
    lat: number;
    lng: number;
    swing: number;
    score: number;
    without: number;
    reports: number;
  };
  top: Top[];
  weekly: Weekly[];
  categories: Record<string, number>;
};

const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export default function DashboardView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard").then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch("/api/cells").then((r) => r.json()),
    ])
      .then(([d, c]) => {
        setDash(d);
        setCells(Array.isArray(c.cells) && c.cells.length ? c.cells : buildCells());
      })
      .catch((e) => setError(`dashboard failed: ${e}`));
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MLMap({
      container: containerRef.current,
      style: STYLE,
      center: CENTER,
      zoom: 12,
      attributionControl: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("risk", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // heatmap, not circles: the question an authority asks is "where is it
      // bad", which is a density question, not a per-cell question
      map.addLayer({
        id: "risk",
        type: "heatmap",
        source: "risk",
        paint: {
          "heatmap-weight": ["get", "risk"],
          "heatmap-intensity": 1,
          "heatmap-radius": 26,
          "heatmap-opacity": 0.75,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0,0,0,0)",
            0.2,
            "#22c55e",
            0.45,
            "#eab308",
            0.7,
            "#ef4444",
            1,
            "#7f1d1d",
          ],
        },
      });
      setMapReady(true);
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !cells.length) return;
    const hour = new Date().getHours();
    (map.getSource("risk") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: cells.map((c) => ({
        type: "Feature" as const,
        properties: { risk: (100 - scoreOf(c, hour)) / 100 },
        geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
      })),
    });
  }, [mapReady, cells]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !dash) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = dash.top.map((t, i) => {
      const el = document.createElement("div");
      el.style.cssText = `width:26px;height:26px;border-radius:50%;background:${BRAND};color:#fff;font:700 12px/26px system-ui;text-align:center;border:2px solid #fff`;
      el.textContent = String(i + 1);
      return new Marker({ element: el }).setLngLat([t.lng, t.lat]).addTo(map);
    });
  }, [mapReady, dash]);

  const maxWeekly = Math.max(1, ...(dash?.weekly ?? []).map((w) => Math.max(w.reports, w.incidents)));
  const maxCat = Math.max(1, ...Object.values(dash?.categories ?? {}));

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold">Authority view</h1>
          <p className="text-[11px] text-muted-foreground">
            Live tables — the same cells users are routed by
          </p>
        </div>
        <Link
          href="/"
          className="rounded-xl bg-black/70 px-3 py-2 text-sm backdrop-blur"
        >
          Map
        </Link>
      </header>

      {error && <p className="px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-4 gap-1.5 p-3">
        <Tile label="Avg safety" value={dash ? String(dash.stats.avgScore) : "…"} color={dash ? scoreColor(dash.stats.avgScore) : undefined} />
        <Tile label="Reports" value={dash ? String(dash.stats.reports) : "…"} />
        <Tile label="Incidents" value={dash ? String(dash.stats.incidents) : "…"} />
        <Tile label="Cells" value={dash ? String(dash.stats.cells) : "…"} />
      </div>

      <div className="relative mx-3 h-56 shrink-0 overflow-hidden rounded-xl">
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      </div>

      <section className="p-3">
        <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Top 10 riskiest cells
        </h2>
        <ol className="space-y-1">
          {(dash?.top ?? []).map((t, i) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-lg bg-black/60 px-2.5 py-2 text-sm backdrop-blur"
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ background: BRAND }}
              >
                {i + 1}
              </span>
              <b style={{ color: scoreColor(t.score), width: "2.2rem" }}>
                {t.score}
              </b>
              <span className="font-mono text-[11px] text-muted-foreground">
                {t.lat.toFixed(3)}, {t.lng.toFixed(3)}
              </span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {t.incidents} inc · {t.reports} rep
              </span>
            </li>
          ))}
          {!dash && (
            <li className="text-sm text-muted-foreground">
              {error ? "Could not load — check the database is seeded." : "Loading…"}
            </li>
          )}
          {dash && dash.top.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No cells yet. Run <code className="font-mono">npm run seed</code>.
            </li>
          )}
        </ol>
      </section>

      <section className="px-3 pb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Incidents + reports per week
          </h2>
          <span className="flex gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-sm bg-white/25" /> incidents
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-sm bg-red-500" /> reports
            </span>
          </span>
        </div>
        <div className="flex h-28 items-end gap-1 rounded-xl bg-black/60 px-1.5 pt-2 pb-1">
          {dash?.weekly.map((w) => (
            <div key={w.weekStart} className="flex h-full flex-1 flex-col justify-end gap-px">
              <div
                className="rounded-t-sm bg-white/25"
                style={{ height: `${(w.incidents / maxWeekly) * 100}%` }}
                title={`week of ${fmtDay(w.weekStart)}: ${w.incidents} incidents`}
              />
              <div
                className="rounded-t-sm bg-red-500"
                style={{ height: `${(w.reports / maxWeekly) * 100}%` }}
                title={`week of ${fmtDay(w.weekStart)}: ${w.reports} reports`}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{dash ? fmtDay(dash.weekly[0].weekStart) : ""}</span>
          <span>{dash ? fmtDay(dash.weekly.at(-1)!.weekStart) : ""}</span>
        </div>
      </section>

      <section className="px-3 pb-4">
        <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What community reports change
        </h2>
        {dash && (
          <>
            <div className="space-y-1 rounded-xl bg-black/60 px-3 py-3 text-xs backdrop-blur">
              <ScoreBar label="With community reports" value={dash.stats.avgScore} color={scoreColor(dash.stats.avgScore)} />
              <ScoreBar
                label="Without them"
                value={dash.stats.avgScoreWithoutReports}
                color={scoreColor(dash.stats.avgScoreWithoutReports)}
                muted
              />
              <p className="pt-1 text-muted-foreground">
                Higher is safer. Citizen reports pull the city average{" "}
                <b className="text-foreground">
                  {dash.stats.avgScoreWithoutReports - dash.stats.avgScore} points
                </b>{" "}
                lower — they are surfacing risk the static crime data alone would have
                rated as safer.
              </p>
            </div>
            {dash.biggestSwing && dash.biggestSwing.swing > 0 && (
              <p className="mt-1 rounded-xl bg-black/60 px-3 py-2 font-mono text-[11px] text-muted-foreground backdrop-blur">
                most affected {dash.biggestSwing.lat.toFixed(3)},{" "}
                {dash.biggestSwing.lng.toFixed(3)}:{" "}
                <b style={{ color: scoreColor(dash.biggestSwing.without) }}>
                  {dash.biggestSwing.without}
                </b>{" "}
                →{" "}
                <b style={{ color: scoreColor(dash.biggestSwing.score) }}>
                  {dash.biggestSwing.score}
                </b>{" "}
                after {dash.biggestSwing.reports} report
                {dash.biggestSwing.reports === 1 ? "" : "s"}
              </p>
            )}
          </>
        )}
        {!dash && <p className="text-sm text-muted-foreground">Loading…</p>}
      </section>

      <section className="px-3 pb-6">
        <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What people are reporting
        </h2>
        <div className="space-y-1">
          {Object.entries(dash?.categories ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 capitalize">{k.replace("_", " ")}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${(v / maxCat) * 100}%`, background: BRAND }} />
                </div>
                <span className="w-5 text-right text-muted-foreground">{v}</span>
              </div>
            ))}
        </div>
        {dash && dash.stats.seededReports > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {dash.stats.seededReports} of {dash.stats.reports} reports are seeded demo history
            (PLAN.md marks this data fake); the rest came from real submissions.
          </p>
        )}
      </section>
    </div>
  );
}

function ScoreBar({
  label,
  value,
  color,
  muted,
}: {
  label: string;
  value: number;
  color?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${muted ? "opacity-40" : ""}`}
          style={{ width: `${value}%`, background: color }}
        />
      </div>
      <span className="w-6 text-right font-mono">{value}</span>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl bg-black/60 px-2 py-2 backdrop-blur">
      <div className="text-lg font-bold" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="text-[10px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}