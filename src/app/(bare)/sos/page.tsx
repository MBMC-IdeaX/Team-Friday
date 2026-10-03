"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  endSosSession,
  deliverQueuedRequest,
  flushRecordings,
  listGuardians,
  newId,
  setActiveSession,
  activeSessionId,
  queueRequest,
  removeGuardian,
  saveGuardian,
  saveRecording,
  type Guardian,
} from "@/lib/offline";
import { navigateTo } from "@/lib/navigation";
import { fetchJson } from "@/lib/network";
import { currentDeviceLocation, sosSeed, watchDeviceLocation } from "@/lib/location";
import { joinSession } from "@/lib/realtime";

// Primary emergency contact — dialed by the big red button.
const EMERGENCY = "9817539373";
const PIN_INTERVAL_MS = 5000;
// chunked so a suspension keeps what came before, and capped so a forgotten
// session cannot quietly fill the device
const CHUNK_MS = 10_000;
const MAX_REC_SEC = 15 * 60;
const ORIGIN_FALLBACK = "";

// Press order matters and is deliberate: the session is written to IndexedDB and
// the uuid is generated BEFORE any fetch, so "SOS fired" is true even with no
// signal. Initial creation is create-once, so stale replay cannot change a session.
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
  const [recSec, setRecSec] = useState(0);
  const [recNote, setRecNote] = useState<string | null>(null);
  const [pendingChunks, setPendingChunks] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const sirenRef = useRef<{ stop: () => void } | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);

  // 1. fire — uuid first, local write second, network last. The id is published
  // to state only once the durable write lands, so "fired" means "persisted".
  //
  // One active session per device: a second tap while a session is live REUSES
  // it rather than opening a new one. That is the false-SOS fix and it needs no
  // identity at all — a panicking double-tap should not re-alert every guardian,
  // and a rate limit that *blocked* a second tap could kill the one call that
  // matters. The pin effect below keeps updating either way.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const previous = activeSessionId();
      if (previous && !navigator.onLine) {
        setSessionId(previous); setPhase("queued"); return;
      }
      if (previous) {
        const existing = await fetch(`/api/sos?id=${previous}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (!cancelled && existing?.session?.status === "active") {
          setSessionId(previous);
          setPhase("live");
          return;
        }
      }
      const id = newId();
      const seed = sosSeed(id);
      // IndexedDB can be unavailable (Safari private browsing used to disable it).
      // The durable write is best-effort: if it fails we still open the session and
      // still go to the network, because a blocked local store must never be the
      // reason the panic button does nothing.
      const queuedKey = await queueRequest("/api/sos", seed).catch(() => {
        if (!cancelled) setRecNote("Offline storage unavailable — this session cannot be saved on the device.");
        return undefined;
      });
      if (cancelled) return;
      setSessionId(id);
      setActiveSession(id);
      if (!navigator.onLine) { setPhase("queued"); return; }
      const delivered = await deliverQueuedRequest(queuedKey, "/api/sos", seed);
      if (!cancelled) setPhase(delivered ? "live" : "queued");
    })();
    listGuardians().then(setGuardians).catch(() => {});
    return () => {
      cancelled = true;
    };
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

  // 4. record — chunked, local-first, uploaded when possible. A 10s chunk that
  // reached IndexedDB survives a page suspension; one long blob would not.
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setRecNote("recording unsupported on this browser");
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setRecNote("microphone blocked — no recording");
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      recStreamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recRef.current = rec;
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        void saveRecording(sessionId, e.data).then(() => flushRecordings().then(setPendingChunks));
      };
      rec.start(CHUNK_MS);
    };
    void start();

    const tick = setInterval(() => {
      setRecSec((s) => {
        // ponytail: hard cap — a session left open should not fill the device
        if (s + 1 >= MAX_REC_SEC && recRef.current?.state === "recording") {
          recRef.current.stop();
        }
        return s + 1;
      });
    }, 1000);

    const upload = () => void flushRecordings().then(setPendingChunks);
    addEventListener("online", upload);

    return () => {
      stopped = true;
      clearInterval(tick);
      removeEventListener("online", upload);
      if (recRef.current?.state === "recording") recRef.current.stop();
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [sessionId]);

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 3. live pin, throttled; retries itself once the network returns. The DB
  // write is the durable copy, the broadcast is the fast path for a guardian
  // whose page is open right now.
  useEffect(() => {
    if (!sessionId) return;
    let last = 0;
    let busy = false;
    let stopped = false;
    const controller = new AbortController();
    const feed = joinSession(sessionId, () => {});
    const send = async () => {
      const fix = currentDeviceLocation();
      const now = Date.now();
      if (!fix || stopped || busy || now - last < PIN_INTERVAL_MS) return;
      const { lat, lng } = fix;
      last = now; busy = true;
      setSentAgo(0);
      void feed.send({ lat, lng, at: now }).catch(() => {});
      try {
        const { response } = await fetchJson("/api/sos", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sessionId, lat, lng }),
          signal: controller.signal,
        });
        if (!stopped) setPhase(response.ok ? "live" : "queued");
      } catch { if (!stopped) setPhase("queued"); }
      finally { busy = false; }
    };
    const stopLocation = watchDeviceLocation(
      (fix) => {
        setGeoError(null);
        setPin({ lat: fix.lat, lng: fix.lng });
        void send();
      },
      (message) => { setGeoError(message); setPin(null); },
    );
    // Retry a fresh pin even if creation/reconnect completed after the GPS callback.
    const retry = setInterval(send, PIN_INTERVAL_MS);
    addEventListener("online", send);
    return () => {
      stopped = true; controller.abort();
      clearInterval(retry); removeEventListener("online", send);
      stopLocation();
      feed.leave();
    };
  }, [sessionId]);

  useEffect(() => {
    if (sentAgo === null) return;
    const t = setInterval(() => setSentAgo((s) => (s === null ? null : s + 1)), 1000);
    return () => clearInterval(t);
  }, [sentAgo]);

  const primary = guardians[0];

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
    if (recRef.current?.state === "recording") recRef.current.stop();
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      await endSosSession(sessionId);
    } catch {
      setGeoError("Could not save the end request. Please try again.");
      return;
    }
    await flushRecordings().catch(() => {});
    navigateTo("/", router);
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

      <p className="rounded-xl bg-black/70 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
        GPS, offline mode and guardian alerts need HTTPS. Over plain http you can
        still call and text.
      </p>

      <p
        className={`rounded-xl px-3 py-2 text-sm ${
          phase === "live"
            ? "bg-emerald-950/60 text-emerald-300"
            : "bg-amber-950/60 text-amber-300"
        }`}
      >
        {phase === "starting" && "Starting…"}
        {phase === "live" && "Guardians can see your live position."}
        {phase === "live" && recSec > 2 && (
          <span className="ml-2 text-red-300">
            ● recording {String(Math.floor(recSec / 60)).padStart(2, "0")}:
            {String(recSec % 60).padStart(2, "0")}
          </span>
        )}
        {phase === "queued" && "No signal — session saved on this phone, sending when back online."}
      </p>

      <div className="grid gap-2">
        {primary ? (
          <a
            href={`tel:${primary.phone}`}
            className="rounded-xl bg-red-600 py-5 text-center text-2xl font-bold text-white"
          >
            CALL {primary.name || primary.phone}
            <span className="block font-mono text-sm font-normal opacity-80">
              {primary.phone}
            </span>
          </a>
        ) : (
          <a
            href={`tel:${EMERGENCY}`}
            className="rounded-xl bg-red-600 py-5 text-center text-2xl font-bold text-white"
          >
            CALL FOR HELP
            <span className="block font-mono text-sm font-normal opacity-80">
              {EMERGENCY}
            </span>
          </a>
        )}
        <button
          onClick={share}
          className="rounded-xl bg-red-600/80 py-4 text-center text-lg font-semibold text-white"
        >
          Message guardians
        </button>
        {guardians.length === 0 && (
          <p className="rounded-xl bg-black/70 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
            Add a guardian below and the call button dials them instead of{" "}
            {EMERGENCY}.
          </p>
        )}
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
        <div className="font-mono text-muted-foreground">
          audio: {recNote ?? (recSec > 0 ? `${recSec}s captured` : "starting…")}
          {pendingChunks > 0 && ` · ${pendingChunks} chunk${pendingChunks === 1 ? "" : "s"} waiting to upload`}
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
