"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { listGuardians, queueRequest, removeGuardian, saveGuardian, type Guardian } from "@/lib/offline";

// CONFIRM PER DEPLOYMENT REGION — this is Nepal's police number.
const EMERGENCY = "100";
const PIN_INTERVAL_MS = 5000;
const ORIGIN_FALLBACK = "";

// Press order matters and is deliberate: the session is written to IndexedDB and
// the uuid is generated BEFORE any fetch, so "SOS fired" is true even with no
// signal. The duplicate POST that follows is an upsert, so replaying it is free.
//
// Pins are never queued — a stale pin misplaces her. The next watchPosition tick
// retries by itself, so the guardian view self-heals one interval after signal.

type Pin = { lat: number; lng: number };

function makeSiren() {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.06;
  osc.type = "square";
  osc.frequency.value = 660;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  const warble = setInterval(() => {
    osc.frequency.value = osc.frequency.value > 700 ? 660 : 880;
  }, 450);
  return {
    running: ctx.state === "running",
    stop: () => {
      clearInterval(warble);
      osc.stop();
      void ctx.close();
    },
  };
}

export default function SosPage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState("");
  const [phase, setPhase] = useState<"starting" | "live" | "queued">("starting");
  const [pin, setPin] = useState<Pin | null>(null);
  const [sentAgo, setSentAgo] = useState<number | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [sirenBlocked, setSirenBlocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const sirenRef = useRef<{ stop: () => void } | null>(null);

  // 1. fire — uuid first, local write second, network last. The id is published
  // to state only once the durable write lands, so "fired" means "persisted".
  useEffect(() => {
    const id = crypto.randomUUID();
    const seed = { id, triggered_by: "tap", lat: 27.7172, lng: 85.324 };
    void queueRequest("/api/sos", seed).then(() => setSessionId(id));
    fetch("/api/sos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(seed),
    })
      .then((r) => setPhase(r.ok ? "live" : "queued"))
      .catch(() => setPhase("queued"));
    listGuardians().then(setGuardians).catch(() => {});
  }, []);

  // 2. stay alive + loud. The siren starts best-effort; the button reports and
  // restarts it, because Chrome autoplay policy may have suspended the context.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const grab = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        /* battery saver or hidden tab — best effort */
      }
    };
    void grab();
    const onVis = () => {
      if (document.visibilityState === "visible" && !lock) void grab();
    };
    document.addEventListener("visibilitychange", onVis);

    try {
      sirenRef.current = makeSiren();
    } catch {
      /* no WebAudio — the SOS screen still works */
    }

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
      sirenRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 3. live pin, throttled; retries itself once the network returns
  useEffect(() => {
    if (!sessionId) return;
    let last = 0;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setPin({ lat, lng });
        const now = Date.now();
        if (now - last < PIN_INTERVAL_MS) return;
        last = now;
        setSentAgo(0);
        fetch("/api/sos", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sessionId, lat, lng }),
        })
          .then((r) => setPhase(r.ok ? "live" : "queued"))
          .catch(() => setPhase("queued"));
      },
      (err) => setGeoError(err.message),
      { enableHighAccuracy: true, maximumAge: 2000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [sessionId]);

  useEffect(() => {
    if (sentAgo === null) return;
    const t = setInterval(() => setSentAgo((s) => (s === null ? null : s + 1)), 1000);
    return () => clearInterval(t);
  }, [sentAgo]);

  const message = () => {
    const where = pin ? `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : "unknown";
    const link = `${window.location.origin || ORIGIN_FALLBACK}/guard/${sessionId}`;
    return `I'm in danger. My last location: ${where}\nLive tracking: ${link}\n— HerGuardian`;
  };

  const share = async () => {
    const text = message();
    // navigator.share hands off to the OS, so it survives with no signal — the
    // OS queues it. sms: is the fallback; both never touch our server.
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* user dismissed the sheet */
      }
    }
    location.href = `sms:?&body=${encodeURIComponent(text)}`;
  };

  const unblockSiren = () => {
    sirenRef.current?.stop();
    sirenRef.current = makeSiren();
    setSirenBlocked(false);
  };

  const end = async () => {
    sirenRef.current?.stop();
    await fetch("/api/sos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sessionId, status: "resolved" }),
    }).catch(() => {});
    router.push("/");
  };

  return (
    <main className="flex min-h-full flex-col gap-3 p-3">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-red-500">SOS active</h1>
        <span className="font-mono text-sm text-muted-foreground">
          {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
          {String(elapsed % 60).padStart(2, "0")}
        </span>
      </header>

      <p
        className={`rounded-xl px-3 py-2 text-sm ${
          phase === "live"
            ? "bg-emerald-950/60 text-emerald-300"
            : "bg-amber-950/60 text-amber-300"
        }`}
      >
        {phase === "starting" && "Starting…"}
        {phase === "live" && "Guardians can see your live position."}
        {phase === "queued" && "No signal — session saved on this phone, sending when back online."}
      </p>

      <div className="grid gap-2">
        <a
          href={`tel:${EMERGENCY}`}
          className="rounded-xl bg-red-600 py-5 text-center text-2xl font-bold text-white"
        >
          CALL {EMERGENCY}
        </a>
        <button
          onClick={share}
          className="rounded-xl bg-red-600/80 py-4 text-center text-lg font-semibold text-white"
        >
          Message guardians
        </button>
      </div>

      {guardians.length > 0 && (
        <div className="grid gap-2">
          {guardians.map((g) => (
            <div key={g.id} className="flex items-center gap-2">
              <a
                href={`tel:${g.phone}`}
                className="flex-1 rounded-xl bg-black/70 px-3 py-3 text-sm backdrop-blur"
              >
                Call {g.name || g.phone}
              </a>
              <a
                href={`sms:${g.phone}?&body=${encodeURIComponent(message())}`}
                className="rounded-xl bg-black/70 px-3 py-3 text-sm backdrop-blur"
              >
                SMS
              </a>
              <button
                onClick={() => {
                  if (g.id != null) void removeGuardian(g.id).then(() => listGuardians().then(setGuardians));
                }}
                className="rounded-xl bg-black/70 px-3 py-3 text-sm text-red-400 backdrop-blur"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <GuardianForm onAdded={() => listGuardians().then(setGuardians)} />

      <div className="space-y-1 rounded-xl bg-black/70 px-3 py-3 text-xs backdrop-blur">
        <div className="font-mono">
          position: {pin ? `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : "waiting for GPS…"}
        </div>
        <div className="font-mono text-muted-foreground">
          {sentAgo === null ? "pin not sent yet" : `pin sent ${sentAgo}s ago`}
        </div>
        {geoError && <div className="text-red-400">GPS: {geoError}</div>}
        <div className="truncate font-mono text-muted-foreground">session: {sessionId}</div>
      </div>

      <div className="flex gap-2">
        <a
          href={sessionId ? `/guard/${sessionId}` : "/"}
          className="flex-1 rounded-xl bg-black/70 px-3 py-3 text-center text-sm backdrop-blur"
        >
          Open guardian view
        </a>
        <button
          onClick={unblockSiren}
          className="rounded-xl bg-black/70 px-3 py-3 text-sm backdrop-blur"
        >
          {sirenBlocked ? "🔇 Tap for alarm" : "🔊 Alarm on"}
        </button>
      </div>

      <button
        onClick={end}
        className="mt-auto rounded-xl border border-red-500/40 px-3 py-4 text-center text-sm text-red-400"
      >
        End session — I&apos;m safe
      </button>
    </main>
  );
}

function GuardianForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!phone.trim()) return;
        void saveGuardian({ name: name.trim(), phone: phone.trim() }).then(() => {
          setName("");
          setPhone("");
          onAdded();
        });
      }}
      className="flex gap-2"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Guardian"
        className="w-1/3 rounded-xl bg-black/70 px-3 py-3 text-sm backdrop-blur"
      />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone"
        inputMode="tel"
        className="w-1/3 rounded-xl bg-black/70 px-3 py-3 text-sm backdrop-blur"
      />
      <button className="flex-1 rounded-xl bg-black/70 px-3 py-3 text-sm backdrop-blur">Add</button>
    </form>
  );
}