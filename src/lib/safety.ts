// FAKE: crime hotspots synthetic until a real Kathmandu dataset lands.
// Scoring is pure TS; the DB only stores the factors (see supabase/schema.sql).

export type Factors = {
  crimeRisk: number; // 0..1
  reportRisk: number; // 0..1
  lighting: number; // 0..1, 1 = well lit
  crowd: number; // 0..1, 1 = busy
};

export type Cell = Factors & { id: number; lat: number; lng: number };

export const WEIGHTS = {
  crime: 0.4,
  reports: 0.25,
  time: 0.15,
  lighting: 0.1,
  crowd: 0.1,
} as const;

// deterministic hash noise so server and client agree
export const hash = (i: number, j: number) => {
  const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const HOTSPOTS = [
  { lat: 27.695, lng: 85.315, r: 0.02, sev: 0.85 },
  { lat: 27.74, lng: 85.37, r: 0.015, sev: 0.7 },
];

const BOUNDS = { lat0: 27.66, lat1: 27.76, lng0: 85.26, lng1: 85.4, step: 0.005 };

export function buildCells(): Cell[] {
  const cells: Cell[] = [];
  let i = 0;
  for (let lat = BOUNDS.lat0; lat <= BOUNDS.lat1 + 1e-9; lat += BOUNDS.step, i++) {
    let j = 0;
    for (let lng = BOUNDS.lng0; lng <= BOUNDS.lng1 + 1e-9; lng += BOUNDS.step, j++) {
      let crimeRisk = 0.15 + hash(i, j) * 0.25;
      for (const h of HOTSPOTS) {
        const d2 = (lat - h.lat) ** 2 + (lng - h.lng) ** 2;
        crimeRisk += h.sev * Math.exp(-d2 / (2 * h.r * h.r));
      }
      cells.push({
        id: i * 1000 + j,
        lat: +lat.toFixed(5),
        lng: +lng.toFixed(5),
        crimeRisk: Math.min(1, crimeRisk),
        reportRisk: hash(j + 7, i + 3) * 0.6,
        lighting: 0.3 + hash(i + 11, j + 5) * 0.7,
        crowd: 0.2 + hash(i + 13, j + 9) * 0.8,
      });
    }
  }
  return cells;
}

// 0 = safe hours (day), 1 = riskiest (late night)
export function timeRisk(hour: number): number {
  if (hour >= 6 && hour < 18) return 0.1;
  if (hour >= 18 && hour < 22) return 0.4;
  if (hour >= 22 || hour < 4) return 1;
  return 0.7; // 4–6
}

export function scoreOf(f: Factors, hour: number): number {
  const s =
    WEIGHTS.crime * (1 - f.crimeRisk) +
    WEIGHTS.reports * (1 - f.reportRisk) +
    WEIGHTS.time * (1 - timeRisk(hour)) +
    WEIGHTS.lighting * f.lighting +
    WEIGHTS.crowd * f.crowd;
  return Math.round(s * 100);
}

// nearest-cell lookup, O(n) — ponytail: fine at ~600 cells, use a grid index if it ever hurts
export function cellAt(cells: Cell[], lat: number, lng: number): Cell {
  let best = cells[0];
  let bestD = Infinity;
  for (const c of cells) {
    const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function safetyAt(cells: Cell[], lat: number, lng: number, hour: number): number {
  return scoreOf(cellAt(cells, lat, lng), hour);
}
