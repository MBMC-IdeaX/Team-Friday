"use client";

import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/network";

// Place search, so a user can type where they are going instead of hunting for a
// pin on a map. Geocoding is OpenStreetMap Nominatim — free, no key, and the same
// data our basemap draws.
//
// ponytail: no geocoding library. Their usage policy asks for at most one request
// per second and forbids autocomplete-as-you-type, so we debounce at 600ms and
// require 3 characters before searching.

export type Place = { label: string; lat: number; lng: number };

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

export function usePlaceSearch(minChars = 3) {
  const [query, setQueryRaw] = useState("");
  // A search that shrinks below the minimum clears results as the user types,
  // rather than from inside the effect.
  const setQuery = (q: string) => {
    setQueryRaw(q);
    if (q.trim().length < minChars) {
      setResults([]);
      setSearching(false);
      setFailed(false);
    }
  };
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    // Nothing to search for: clearing the list happens in the setQuery handler
    // below, so this effect never setStates synchronously.
    if (q.length < minChars) {
      timer.current = null;
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    timer.current = setTimeout(() => {
      setSearching(true);
      const url = new URL(ENDPOINT);
      url.searchParams.set("q", q);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "6");
      url.searchParams.set("accept-language", "en");
      fetchJson<{ display_name: string; lat: string; lon: string }[]>(url, { signal: controller.signal })
        .then(({ response, data }) => response.ok ? data : Promise.reject(response.status))
        .then((json: { display_name: string; lat: string; lon: string }[]) => {
          if (cancelled) return;
          setResults(
            json.map((j) => ({ label: j.display_name, lat: +j.lat, lng: +j.lon })),
          );
          setFailed(false);
        })
        .catch(() => {
          if (cancelled) return;
          // Never a dead end: the user can still tap the map to set a point.
          setResults([]);
          setFailed(true);
        })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 600);
    return () => {
      cancelled = true; controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, minChars]);

  return { query, setQuery, results, searching, failed };
}

export default function PlaceSearch({
  placeholder,
  onPick,
}: {
  placeholder: string;
  onPick: (p: Place) => void;
}) {
  const { query, setQuery, results, searching, failed } = usePlaceSearch();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        placeholder={placeholder}
        className="w-full rounded-xl bg-black/70 px-3 py-3 text-sm backdrop-blur"
      />
      {open && (query.trim().length >= 3 || searching) && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl bg-black/90 backdrop-blur">
          {searching && results.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>
          )}
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(r);
                  setQuery(r.label.split(",")[0]);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-white/10"
              >
                {r.label}
              </button>
            </li>
          ))}
          {!searching && results.length === 0 && failed && (
            <li className="px-3 py-2 text-xs text-amber-400">
              Place search needs internet and may be unavailable. Tap the map or reuse a saved destination.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}