export type SavedPlace = { label: string; lat: number; lng: number };
const CACHE = "hg-v1-map-data";
const KEY = "/__offline/places";
const valid = (p: SavedPlace) => p && typeof p.label === "string" && p.label.length > 0 && p.label.length <= 1000 &&
  Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;
export async function readSavedPlaces(): Promise<SavedPlace[]> {
  try {
    const response = await (await caches.open(CACHE)).match(KEY);
    const places = response ? await response.json() : [];
    return Array.isArray(places) ? places.filter(valid).slice(0, 20) : [];
  } catch { return []; }
}
export async function savePlace(place: SavedPlace) {
  if (!valid(place)) return false;
  try {
    const previous = await readSavedPlaces();
    const places = [place, ...previous.filter(p => p.lat !== place.lat || p.lng !== place.lng)].slice(0, 20);
    await (await caches.open(CACHE)).put(KEY, Response.json(places));
    return true;
  } catch { return false; }
}
