"use client";

import { useEffect, useState } from "react";

import {
  fetchNearby,
  HOTLINES,
  METRO_POLICE,
  type NearbyPlace,
} from "@/lib/emergency";

const KIND_LABEL: Record<NearbyPlace["kind"], string> = {
  police: "Police",
  hospital: "Hospital",
  clinic: "Clinic",
};

const fmt = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

export default function HelpPage() {
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const [places, setPlaces] = useState<NearbyPlace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Starts false on BOTH server and client. A lazy initialiser looked safe, but
  // Node has a global `navigator` since v21, so at build time geolocation is
  // missing and the prerendered HTML claimed the browser had no location API —
  // React #418 on every load. Detecting it in an effect instead means the first
  // paint is identical everywhere.
  const [geoMissing, setGeoMissing] = useState(false);

  useEffect(() => {
    // requestAnimationFrame keeps the setState out of the effect body, which is
    // what the react-hooks lint rule (rightly) objects to.
    const raf = requestAnimationFrame(() => {
      if (!navigator.geolocation) {
        setGeoMissing(true);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => {
          setWhere({ lat: p.coords.latitude, lng: p.coords.longitude });
          setBusy(true);
        },
        () => setErr("Location permission denied — showing national numbers only."),
        { timeout: 8000 },
      );
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Every setState below is inside a promise callback, so nothing here updates
  // state synchronously during the effect itself.
  useEffect(() => {
    if (!where) return;
    let cancelled = false;
    fetchNearby(where.lat, where.lng)
      .then((r) => !cancelled && setPlaces(r))
      .catch((e) => !cancelled && setErr((e as Error).message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [where]);

  return (
    <main className="p-3">
      <h1 className="text-lg font-semibold">Get help</h1>

      <p className="mt-1 rounded-xl bg-red-950/60 px-3 py-2 text-xs text-red-200">
        In an emergency dial <b>100</b> for police or <b>102</b> for an ambulance. Don&apos;t
        travel to a location from a list.
      </p>

      <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Numbers verified from official sources
      </h2>
      <ul className="mt-1 space-y-1.5">
        {HOTLINES.map((h) => (
          <li key={h.id} className="flex items-center gap-2 rounded-xl bg-black/70 p-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{h.label}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {h.note ?? h.hours ?? ""}
              </p>
            </div>
            <a
              href={`tel:${h.number}`}
              className="shrink-0 rounded-lg bg-red-600 px-3 py-2 font-mono text-xs font-bold text-white"
            >
              {h.number}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Sources: nepalpolice.gov.np, nwchelpline.gov.np. Verify before relying on anything
        here — numbers change.
      </p>

      <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Near you
      </h2>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Live from OpenStreetMap — the same data our map draws. Coverage is uneven, so a place
        missing here may still exist.
      </p>

      {geoMissing && <p className="mt-2 text-sm text-amber-400">This browser has no location API.</p>}
      {!where && !err && !geoMissing && (
        <p className="mt-2 text-sm text-muted-foreground">Finding you…</p>
      )}
      {err && <p className="mt-2 text-sm text-amber-400">{err}</p>}
      {busy && <p className="mt-2 text-sm text-muted-foreground">Looking up nearby places…</p>}

      <ul className="mt-2 space-y-1.5">
        {(places ?? []).map((p) => (
          <li key={p.id} className="flex items-center gap-2 rounded-xl bg-black/70 p-2.5">
            <span
              className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold"
              style={{
                background: p.kind === "police" ? "#1b7a86" : p.kind === "hospital" ? "#7f1d1d" : "#14532d",
              }}
            >
              {KIND_LABEL[p.kind]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{p.name}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {fmt(p.distanceM)}
                {p.emergency === "yes" ? " · 24/7 emergency" : ""}
              </p>
            </div>
            <a
              href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-lg bg-black/70 px-3 py-2 text-[11px]"
            >
              Map
            </a>
          </li>
        ))}
        {places?.length === 0 && (
          <li className="rounded-xl bg-black/70 p-3 text-sm text-muted-foreground">
            Nothing mapped within 5 km. This is an OpenStreetMap coverage gap, not proof that
            there are no facilities here.
          </li>
        )}
      </ul>

      <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Metropolitan police circles
      </h2>
      <ul className="mt-1 space-y-1.5">
        {METRO_POLICE.map((m) => (
          <li key={m.label} className="flex items-center gap-2 rounded-xl bg-black/70 p-2.5">
            <p className="flex-1 text-xs">{m.label}</p>
            {m.numbers.map((n) => (
              <a
                key={n}
                href={`tel:${n}`}
                className="shrink-0 rounded-lg bg-black/70 px-2.5 py-2 font-mono text-[11px]"
              >
                {n}
              </a>
            ))}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Landlines for the three metropolitan circles. For your own police station, dial 100 —
        station numbers change and we would rather point you at the always-correct answer.
      </p>
    </main>
  );
}