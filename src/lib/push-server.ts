import webpush from "web-push";

import { dbConfigured, supabase } from "@/lib/db";
import { isSessionId } from "@/lib/push-contract";

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

type Subscription = { id: number; endpoint: string; p256dh: string; auth: string; fail_count: number };

// Returns provider acceptance, not proof that a device displayed a notification.
export async function alertGuardians(sessionId: string): Promise<number> {
  if (!isSessionId(sessionId)) throw new Error("Invalid push session");
  const sb = supabase();
  if (!dbConfigured() || !sb || !ready()) throw new Error("Push not configured");
  const { data, error } = await sb.from("push_subscription_sessions")
    .select("push_subscriptions!inner(id,endpoint,p256dh,auth,fail_count)")
    .eq("session_id", sessionId);
  if (error) throw new Error("Push recipient lookup failed");
  const subscriptions = (data ?? []).map((row) => row.push_subscriptions as unknown as Subscription);
  const payload = JSON.stringify({ sessionId, title: "HerGuardian SOS",
    body: "Emergency SOS activated. Tap to view the guardian session." });
  let accepted = 0;
  let maintenanceFailed = false;
  await Promise.all(subscriptions.map(async (s) => {
    let status: number | undefined;
    let delivered = false;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload, { TTL: 300, urgency: "high" });
      delivered = true;
      accepted++;
    } catch (error) {
      status = (error as { statusCode?: number })?.statusCode;
    }
    try {
      const result = status === 404 || status === 410
        ? await sb.from("push_subscriptions").delete().eq("id", s.id)
        : await sb.from("push_subscriptions").update(delivered
          ? { fail_count: 0, last_ok_at: new Date().toISOString() }
          : { fail_count: Math.min(s.fail_count + 1, 32767) }).eq("id", s.id);
      if (result.error) maintenanceFailed = true;
    } catch { maintenanceFailed = true; }
  }));
  if (maintenanceFailed) console.error("Push subscription maintenance failed.");
  return accepted;
}
