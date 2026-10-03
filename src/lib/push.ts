"use client";

import { isSessionId, subscriptionPayload } from "./push-contract";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator &&
    "PushManager" in window && "Notification" in window;
}

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Service worker unavailable. Push requires the production PWA.")), 8_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function enablePush(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: "This browser cannot receive push. On iOS, add HerGuardian to your Home Screen first." };
  if (!isSessionId(sessionId)) return { ok: false, error: "Invalid guardian session." };
  try {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) return { ok: false, error: "VAPID public key is not configured." };
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, error: "Notification permission was declined." };
    const reg = await serviceWorkerReady();
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) as BufferSource,
    });
    const res = await fetch("/api/push/subscribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscriptionPayload(sub.toJSON(), sessionId)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `Could not save session subscription (${res.status})` };
    return { ok: true };
  } catch (error) {
    // Do not surface provider errors containing subscription details.
    return { ok: false, error: error instanceof Error && error.message.startsWith("Service worker unavailable")
      ? error.message : "Could not enable push. Check permission and network access." };
  }
}

export async function currentPushEnabled(sessionId: string): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted" || !isSessionId(sessionId)) return false;
  try {
    const reg = await serviceWorkerReady();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    const query = new URLSearchParams({ endpoint: sub.endpoint, sessionId });
    const res = await fetch(`/api/push/subscribe?${query}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return res.ok && (await res.json()).armed === true;
  } catch {
    return false;
  }
}
