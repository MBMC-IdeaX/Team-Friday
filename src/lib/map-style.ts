// Shared map style so the map screen and the guardian tracker render the same
// city, basemap and brand colour. Extracted in S.4 — the guardian page needs
// all three and duplicating them is how the two screens drift apart.

export const CENTER: [number, number] = [85.324, 27.7172]; // Kathmandu demo city
export const BRAND = "#1b7a86";

// OSM standard tiles: no API key, no watermark (hackathon demo traffic)
export const STYLE = {
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

export const scoreColor = (s: number) => (s >= 70 ? "#22c55e" : s >= 45 ? "#eab308" : "#ef4444");