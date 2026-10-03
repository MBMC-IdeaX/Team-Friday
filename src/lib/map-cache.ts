import type { Cell } from "./safety";
import { fetchJson } from "./network";

export type Route = { id: number; duration: number; distance: number; safety: number; coords: [number, number][] };
export type RoutesRes = { routes: Route[]; shortestId: number; safestId: number; hour: number };
export type SafetyData = { cells: Cell[]; source: "db" | "fake" };
export type Journey = { from: { lat: number; lng: number }; to: { lat: number; lng: number }; routes: RoutesRes };
export type Saved<T> = { savedAt: number; value: T };
const CACHE = "hg-v1-map-data";
const SAFETY_KEY = "/__offline/safety";
const MAX_ROUTE_AGE = 24 * 60 * 60 * 1000;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export function validSafetyData(value: unknown): value is SafetyData {
  const data = value as SafetyData | null;
  return !!data && ["db", "fake"].includes(data.source) && Array.isArray(data.cells) && data.cells.length > 0 &&
    data.cells.every(c => c && finite(c.id) && finite(c.lat) && Math.abs(c.lat) <= 90 && finite(c.lng) && Math.abs(c.lng) <= 180 &&
      [c.crimeRisk, c.reportRisk, c.lighting, c.crowd].every(v => finite(v) && v >= 0 && v <= 1));
}
export function validRoutes(value: unknown): value is RoutesRes {
  const data = value as RoutesRes | null;
  return !!data && finite(data.hour) && data.hour >= 0 && data.hour < 24 && Array.isArray(data.routes) && data.routes.length > 0 &&
    data.routes.every(r => r && finite(r.id) && finite(r.duration) && r.duration >= 0 && finite(r.distance) && r.distance >= 0 &&
      finite(r.safety) && r.safety >= 0 && r.safety <= 100 && Array.isArray(r.coords) && r.coords.length >= 2 &&
      r.coords.every(c => Array.isArray(c) && c.length === 2 && finite(c[0]) && Math.abs(c[0]) <= 180 && finite(c[1]) && Math.abs(c[1]) <= 90)) &&
    data.routes.some(r => r.id === data.shortestId) && data.routes.some(r => r.id === data.safestId);
}
async function read<T>(key: string, valid: (value: unknown) => value is T): Promise<Saved<T> | null> {
  try {
    const cache = await caches.open(CACHE);
    const response = await cache.match(key);
    const data = response ? await response.json() : null;
    return data && finite(data.savedAt) && valid(data.value) ? data : null;
  } catch { return null; }
}
async function write<T>(key: string, value: T): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(key, Response.json({ savedAt: Date.now(), value }));
    return true;
  } catch { return false; }
}
export const readSafetyCache = () => read(SAFETY_KEY, validSafetyData);
export async function saveSafetyCache(value: unknown) {
  if (!validSafetyData(value)) return false;
  // A database outage must not replace a saved real dataset with demo factors.
  if (value.source === "fake" && (await readSafetyCache())?.value.source === "db") return false;
  return write(SAFETY_KEY, value);
}
export function routeCacheKey(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  return `/__offline/routes?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`;
}
export async function readRouteCache(key: string) {
  const saved = await read(key, validRoutes);
  return saved && Date.now() - saved.savedAt >= 0 && Date.now() - saved.savedAt <= MAX_ROUTE_AGE ? saved : null;
}
export async function saveRouteCache(key: string, value: unknown) {
  return validRoutes(value) ? write(key, value) : false;
}

const LAST_ROUTE_KEY = "/__offline/last-route";
const validPoint = (p: { lat: number; lng: number } | null) => p && finite(p.lat) && finite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
const validJourney = (value: unknown): value is Journey => {
  const journey = value as Journey | null;
  return !!journey && !!validPoint(journey.from) && !!validPoint(journey.to) && validRoutes(journey.routes);
};
const usableAge = (saved: Saved<unknown>) => Date.now() - saved.savedAt >= 0 && Date.now() - saved.savedAt <= MAX_ROUTE_AGE;
export async function saveJourney(from: Journey["from"], to: Journey["to"], routes: RoutesRes) {
  const journey = { from, to, routes };
  // Geometry and endpoints commit together; a missing second write cannot lose the journey.
  return validJourney(journey) ? write(LAST_ROUTE_KEY, journey) : false;
}
export async function readLastJourney() {
  const complete = await read(LAST_ROUTE_KEY, validJourney);
  if (complete && usableAge(complete)) return { savedAt: complete.savedAt, value: complete.value.routes, from: complete.value.from, to: complete.value.to };
  // Preserve old journeys written as a pointer plus a separate route record.
  try {
    const response = await (await caches.open(CACHE)).match(LAST_ROUTE_KEY);
    const old = response ? await response.json() : null;
    if (!old || !validPoint(old.from) || !validPoint(old.to)) return null;
    const saved = await readRouteCache(routeCacheKey(old.from, old.to));
    return saved ? { ...saved, from: old.from as Journey["from"], to: old.to as Journey["to"] } : null;
  } catch { return null; }
}
export async function lastRouteDestination(from: { lat: number; lng: number }) {
  const last = await readLastJourney();
  return last && last.from.lat === from.lat && last.from.lng === from.lng ? last.to : null;
}
export async function loadRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }, signal: AbortSignal) {
  const key = routeCacheKey(from, to);
  try {
    if (!navigator.onLine) throw new Error("offline");
    const { response, data } = await fetchJson(`/api/routes?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`, { signal }, 12_000);
    const value: unknown = response.ok ? data : null;
    if (!validRoutes(value)) throw new Error("invalid route");
    if (signal.aborted) throw new Error("cancelled");
    const stored = await saveJourney(from, to, value);
    await saveRouteCache(key, value);
    return { value, savedAt: Date.now(), cached: false, persisted: stored };
  } catch {
    if (signal.aborted) throw new Error("cancelled");
    const saved = await readRouteCache(key);
    if (saved) return { ...saved, cached: true, persisted: true };
    throw new Error(navigator.onLine
      ? "Routing unavailable or timed out, and no saved route matches these points. Try again online."
      : "Offline: no saved route matches these points. Connect to generate this route; place search also needs internet.");
  }
}
