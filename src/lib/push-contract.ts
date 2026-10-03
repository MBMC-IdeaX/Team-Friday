export const isSessionId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length >= 2048) return false;
  try {
    const url = new URL(value);
    // Do not turn arbitrary HTTPS URLs into server-side push requests.
    const host = url.hostname;
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
       host.endsWith(".notify.windows.com") || host === "web.push.apple.com");
  } catch {
    return false;
  }
}

export const isPushKey = (value: unknown, kind: "p256dh" | "auth"): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) &&
  value.length === (kind === "p256dh" ? 87 : 22);

export function subscriptionPayload(subscription: PushSubscriptionJSON, sessionId: string) {
  if (!isSessionId(sessionId) || !isPushEndpoint(subscription.endpoint) ||
      !isPushKey(subscription.keys?.p256dh, "p256dh") || !isPushKey(subscription.keys?.auth, "auth")) {
    throw new Error("Invalid session or browser push subscription keys.");
  }
  return { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth, sessionId };
}
