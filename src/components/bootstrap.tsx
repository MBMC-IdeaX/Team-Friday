"use client";

import { useEffect } from "react";

import { flushOutbox, flushRecordings } from "@/lib/offline";

// App-startup wiring, mounted once from layout so /sos and /guard/[id] get it too.
export default function Bootstrap() {
  useEffect(() => {
    // ponytail: production only. A caching SW in dev fights HMR — the
    // /_next/static entries are unhashed there, so cacheFirst serves stale chunks.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // Flush whatever the last session queued, then again on every reconnect.
    // Recordings matter most: they are the evidence, and the chunks are the only
    // thing still on the device when the network comes back.
    const flush = () => {
      void flushOutbox().catch(() => {});
      void flushRecordings().catch(() => {});
    };
    flush();
    const onOnline = () => flush();
    addEventListener("online", onOnline);
    return () => removeEventListener("online", onOnline);
  }, []);

  return null;
}