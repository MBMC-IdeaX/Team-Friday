"use client";

import { useEffect } from "react";

import { flushOutbox } from "@/lib/offline";

// App-startup wiring, mounted once from layout so /sos and /guard/[id] get it too.
export default function Bootstrap() {
  useEffect(() => {
    // ponytail: production only. A caching SW in dev fights HMR — the
    // /_next/static entries are unhashed there, so cacheFirst serves stale chunks.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // Flush whatever the last session queued, then again on every reconnect.
    flushOutbox().catch(() => {});
    const onOnline = () => void flushOutbox().catch(() => {});
    addEventListener("online", onOnline);
    return () => removeEventListener("online", onOnline);
  }, []);

  return null;
}