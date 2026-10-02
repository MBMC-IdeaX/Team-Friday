"use client";

// Web Push, client side. This is the only channel that reaches a guardian whose
// browser tab is closed — and the reason it matters for safety is that the push
// goes server→guardian, so it still lands when the person in danger has no
// signal at all.
//
// Two platform facts that shape this file:
//   - iOS exposes Push API ONLY to a Home Screen web app, 16.4+
//   - the permission prompt must come from a real tap, never on load
// So `enablePush` is only ever called from a click handler, and the UI must
// degrade quietly when the platform will not cooperate.

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// applicationServerKey is a base64url VAPID public key and PushManager wants raw bytes.
function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enablePush(guardianId: string): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) {
    return { ok: false, error: "This browser cannot receive push. On iOS, add HerGuardian to your Home Screen first." };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, error: "Notification permission was declined." };

  const reg = await navigator.serviceWorker.ready;
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return { ok: false, error: "VAPID public key is not configured." };

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(key) as BufferSource,
    }));

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...sub.toJSON(), guardianId }),
  });
  if (!res.ok) return { ok: false, error: `Could not save subscription (${res.status})` };
  return { ok: true };
}

export async function currentPushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  return !!(await reg.pushManager.getSubscription());
}
