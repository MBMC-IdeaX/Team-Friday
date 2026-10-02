"use client";

import { useEffect } from "react";

// ponytail: production only. A caching SW in dev fights HMR — the /_next/static
// entries are unhashed there, so cacheFirst would serve stale chunks.
export default function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}