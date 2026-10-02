import webpush from "web-push";

import { dbConfigured, supabase } from "@/lib/db";

// Server-side Web Push. Lives here rather than in a route file so /api/sos can
// fire an alert without importing a route module.
//
// This is the only channel that reaches a guardian whose browser is closed or
// asleep. The push goes server→guardian, so it still lands when the person in
// danger has no data at all — which is the whole reason it exists alongside
// Realtime.
//
// fire-and-forget by design: an SOS must never wait on, or fail because of, a
// push service. The SOS path does not await this.

let configured = false;

function ready(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails("mailto:team@herguardian.app", pub, priv);
  configured = true;
  return true;
}

export async function alertGuardians(
  sessionId: string,
  lat: number | null,
  lng: number | null,
): Promise<number> {
  const sb = supabase();
  if (!dbConfigured() || !sb || !ready()) return 0;
  const { data: subs } = await sb
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,fail_count");
  if (!subs?.length) return 0;

  const where =
    lat != null && lng != null ? `Last location: ${lat.toFixed(5)}, ${lng.toFixed(5)}` : "";
  const payload = JSON.stringify({
    sessionId,
    title: "SOS — someone needs help",
    body: where || "Tap to open live tracking.",
  });

  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 300, urgency: "high" },
        );
        sent++;
        await sb
          .from("push_subscriptions")
          .update({ fail_count: 0, last_ok_at: new Date().toISOString() })
          .eq("id", s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410 mean the push service has retired the endpoint; anything else is
        // transient, so only count it toward pruning.
        if (status === 404 || status === 410) {
          await sb.from("push_subscriptions").delete().eq("id", s.id);
        } else {
          await sb
            .from("push_subscriptions")
            .update({ fail_count: s.fail_count + 1 })
            .eq("id", s.id);
        }
      }
    }),
  );
  return sent;
}