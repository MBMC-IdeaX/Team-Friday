import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import { BRAND } from "./map-style";
import { scoreOf, type Cell } from "./safety";
import type { RoutesRes } from "./map-cache";

export type OverlayStatus = { stage: "waiting-style" | "processing" | "source-ready" | "rendered" | "failed"; cells: number; rendered: number };
const empty = () => ({ type: "FeatureCollection" as const, features: [] });
const line = (coords: [number, number][] = []) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: coords } });

// Keep the actual payload with the map, including when a style replaces its sources.
export function bindMapOverlays(map: MLMap, notify: (status: OverlayStatus) => void, timeoutMs = 10_000) {
  let safety: GeoJSON.FeatureCollection = empty();
  let shortest: GeoJSON.Feature = line(), safest: GeoJSON.Feature = line();
  let ready = false, busy = false, disposed = false;
  let lastStatus: OverlayStatus | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const applied = new Map<GeoJSONSource, GeoJSON.GeoJSON>();
  const failures = new Set<string>();
  const report = (stage: OverlayStatus["stage"], rendered = 0) => {
    if (disposed) return;
    const status = { stage, cells: safety.features.length, rendered };
    if (lastStatus?.stage === stage && lastStatus.cells === status.cells && lastStatus.rendered === rendered) return;
    lastStatus = status;
    notify(status);
  };
  const inspect = () => {
    if (!ready || disposed || !safety.features.length || !map.getLayer("cells")) return;
    if (failures.size) return;
    if (!map.isSourceLoaded("cells")) return;
    clearTimeout(timer);
    const rendered = map.queryRenderedFeatures({ layers: ["cells"] }).length;
    report(rendered ? "rendered" : "source-ready", rendered);
  };
  const fail = (id = "cells") => { failures.add(id); clearTimeout(timer); report("failed"); };
  const sync = () => {
    if (disposed || busy || !ready) return;
    busy = true;
    try {
      for (const [id, payload] of [["cells", safety], ["shortest", shortest], ["safest", safest]] as const) {
        if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: payload });
        if (!map.getLayer(id)) {
          if (id === "cells") map.addLayer({ id, type: "circle", source: id, paint: {
            "circle-radius": 18, "circle-opacity": 0.32,
            "circle-color": ["step", ["get", "risk"], BRAND, 0.35, "#eab308", 0.58, "#ef4444"],
          } });
          else map.addLayer({ id, type: "line", source: id, paint: {
            "line-color": id === "safest" ? BRAND : "#94a3b8",
            "line-width": id === "safest" ? 5 : 3,
            "line-dasharray": id === "safest" ? [1, 0] : [2, 2],
          } });
        }
        const source = map.getSource<GeoJSONSource>(id)!;
        if (applied.get(source) === payload) continue;
        applied.set(source, payload);
        failures.delete(id);
        if (id === "cells" && safety.features.length) {
          report(failures.size ? "failed" : "processing"); clearTimeout(timer); timer = setTimeout(fail, timeoutMs);
        }
        void source.setData(payload).then(() => {
          if (!disposed && map.getSource(id) === source) inspect();
        }).catch(() => { if (!disposed && map.getSource(id) === source && applied.get(source) === payload) fail(id); });
      }
    } catch { fail(); }
    finally { busy = false; }
  };
  const replacing = () => { ready = false; applied.clear(); failures.clear(); };
  const style = () => { ready = true; sync(); };
  const error = (event: { sourceId?: string; error?: { message: string } }) => {
    if (["cells", "shortest", "safest"].includes(event.sourceId ?? "")) fail(event.sourceId);
    else if (/worker|geojson|module/i.test(event.error?.message ?? "")) fail();
  };
  map.on("styledataloading", replacing);
  map.on("style.load", style);
  map.on("styledata", sync);
  map.on("sourcedata", inspect);
  map.on("render", inspect);
  map.on("error", error);
  return {
    setSafety(cells: Cell[], hour: number) {
      safety = { type: "FeatureCollection", features: cells.map(cell => {
        const score = scoreOf(cell, hour);
        return { type: "Feature", properties: { score, risk: (100 - score) / 100 }, geometry: { type: "Point", coordinates: [cell.lng, cell.lat] } };
      }) };
      if (!ready && cells.length) { report("waiting-style"); clearTimeout(timer); timer = setTimeout(fail, timeoutMs); }
      sync();
    },
    setRoutes(data: RoutesRes | null) {
      shortest = line(data?.routes.find(route => route.id === data.shortestId)?.coords);
      safest = line(data?.routes.find(route => route.id === data.safestId)?.coords);
      sync();
    },
    dispose() {
      disposed = true; clearTimeout(timer); applied.clear();
      map.off("styledataloading", replacing);
      map.off("style.load", style); map.off("styledata", sync);
      map.off("sourcedata", inspect); map.off("render", inspect); map.off("error", error);
    },
  };
}
