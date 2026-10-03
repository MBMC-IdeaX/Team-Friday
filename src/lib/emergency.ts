// Emergency information for Nepal.
//
// PROVENANCE MATTERS HERE. This file feeds numbers people dial in a crisis, so
// every entry says where it came from, and nothing plausible-looking is invented.
// Two tiers:
//
//   HELPLINES — hand-verified against nepalpolice.gov.np and nwchelpline.gov.np.
//   NEARBY   — live from OpenStreetMap via Overpass, i.e. the same source as our
//              own basemap. Real places, real coordinates, but OSM coverage is
//              uneven, so a missing hospital may still exist.
//
// The honest advice, and the one we show in the UI: in an emergency dial 100 or
// 102. Use the nearby list to find the place once you are already able to travel.

export type Hotline = {
  id: string;
  label: string;
  number: string;
  note?: string;
  hours?: string;
  source: string;
};

// Verified against nepalpolice.gov.np emergency contacts and nwchelpline.gov.np.
export const HOTLINES: Hotline[] = [
  { id: "police", label: "Nepal Police", number: "100", note: "24/7, free", source: "nepalpolice.gov.np" },
  { id: "police-tollfree", label: "Police (toll free)", number: "16600141516", note: "Alternative to 100", source: "nepalpolice.gov.np" },
  { id: "ambulance", label: "Ambulance", number: "102", note: "24/7, free", source: "nepalpolice.gov.np" },
  { id: "fire", label: "Fire", number: "101", note: "24/7, free", source: "nepalpolice.gov.np" },
  { id: "women", label: "Women Helpline", number: "1145", note: "National Women's Commission", source: "nwchelpline.gov.np" },
  { id: "nwc", label: "National Women's Commission", number: "01-4256701", note: "Bhadrakali Plaza, Kathmandu", source: "nwchelpline.gov.np" },
  { id: "child", label: "Child Helpline", number: "1098", source: "nepalpolice.gov.np" },
  { id: "traffic", label: "Traffic Police", number: "103", source: "nepalpolice.gov.np" },
  { id: "tpo", label: "TPO Nepal (psychosocial)", number: "16600102005", hours: "8am–6pm", source: "UN Women Asia-Pacific helpline list" },
  { id: "saathi", label: "Saathi Women's Shelter", number: "01-5191103", note: "Shelter and counselling", source: "UN Women Asia-Pacific helpline list" },
];

// Metropolitan police circles, from nph.nepalpolice.gov.np. Per-station landlines
// change, so we show these three and tell people to dial 100 for their own area.
export const METRO_POLICE = [
  { label: "Metropolitan Police, Kathmandu", numbers: ["4261945", "4261790"] },
  { label: "Metropolitan Police, Lalitpur", numbers: ["5521207"] },
  { label: "Metropolitan Police, Bhaktapur", numbers: ["6614821"] },
];

// ---------- nearby facilities, live from OpenStreetMap ----------

export type NearbyPlace = {
  id: string;
  name: string;
  kind: "police" | "hospital" | "clinic";
  lat: number;
  lng: number;
  distanceM: number;
  emergency?: string;
};

const RADIUS_DEG = 0.045; // ~5 km, enough for a city
const OVERPASS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la = (aLat * Math.PI) / 180;
  const lb = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Live nearby facilities from OpenStreetMap. Runs client-side so the browser
 * sends its own User-Agent, which Overpass requires.
 *
 * ponytail: no proxy and no key. Overpass is free and CORS-enabled; the mirrors
 * are a list because the public endpoints rate-limit each other independently.
 */
export async function fetchNearby(
  lat: number,
  lng: number,
  kinds: NearbyPlace["kind"][] = ["police", "hospital", "clinic"],
): Promise<NearbyPlace[]> {
  const selectors = kinds
    .map((k) => `node["amenity"="${k}"](${(lat - RADIUS_DEG).toFixed(4)},${(lng - RADIUS_DEG).toFixed(4)},${(lat + RADIUS_DEG).toFixed(4)},${(lng + RADIUS_DEG).toFixed(4)});`)
    .join("");
  const query = `[out:json][timeout:20];(${selectors});out center 60;`;

  let lastError = "";
  for (const host of OVERPASS) {
    try {
      const res = await fetch(host, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) {
        lastError = `${host} → ${res.status}`;
        continue;
      }
      const json = (await res.json()) as {
        elements?: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[];
      };
      const places: NearbyPlace[] = [];
      for (const el of json.elements ?? []) {
        const la = el.lat ?? el.center?.lat;
        const ln = el.lon ?? el.center?.lon;
        const kind = el.tags?.amenity as NearbyPlace["kind"] | undefined;
        if (la == null || ln == null || !kind) continue;
        places.push({
          id: `${el.type}/${el.id}`,
          name: el.tags?.name || el.tags?.["name:en"] || "(unnamed in OpenStreetMap)",
          kind,
          lat: la,
          lng: ln,
          distanceM: Math.round(haversine(lat, lng, la, ln)),
          emergency: el.tags?.emergency,
        });
      }
      places.sort((a, b) => a.distanceM - b.distanceM);
      return places.slice(0, 25);
    } catch (e) {
      lastError = `${host} → ${(e as Error).message}`;
    }
  }
  throw new Error(`Could not reach OpenStreetMap lookup. ${lastError}`);
}