"use client";

import { useEffect } from "react";

import { offlineLink } from "@/lib/navigation";
import { flushOutbox, flushRecordings } from "@/lib/offline";

// App-startup wiring, mounted once from layout so /sos and /guard/[id] get it too.
export default function Bootstrap() {
  useEffect(() => {
    // ponytail: production only. A caching SW in dev fights HMR — the
    // /_next/static entries are unhashed there, so cacheFirst serves stale chunks.
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      } else if (typeof navigator.serviceWorker.getRegistrations === "function") {
        // A production worker persists when this origin switches back to dev.
        const scriptURL = new URL("/sw.js", location.origin).href;
        const scope = new URL("/", location.origin).href;
        void navigator.serviceWorker.getRegistrations().then((registrations) =>
          Promise.all(registrations.filter((registration) => {
            const workers = [registration.active, registration.waiting, registration.installing]
              .filter((worker) => worker !== null);
            return registration.scope === scope && workers.length > 0 &&
              workers.every((worker) => worker.scriptURL === scriptURL);
          }).map((registration) => registration.unregister())),
        ).catch(() => {});
      }
    }

    // Flush whatever the last session queued, then again on every reconnect.
    // Recordings matter most: they are the evidence, and the chunks are the only
    // thing still on the device when the network comes back.
    const flush = () => {
      void flushOutbox().catch(() => {});
      void flushRecordings().catch(() => {});
    };
    flush();
    document.addEventListener("click", offlineLink, true);
    const onOnline = () => flush();
    addEventListener("online", onOnline);
    return () => {
      removeEventListener("online", onOnline);
      document.removeEventListener("click", offlineLink, true);
    };
  }, []);

  return null;
}
