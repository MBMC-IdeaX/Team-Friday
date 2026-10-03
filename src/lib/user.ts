"use client";

import { useEffect, useState } from "react";

import { sb } from "./browser-client";
import { clearDeviceAccount, getDeviceAccount, saveDeviceAccount } from "./offline";

// Sign-in is ONE TIME and permanent, and it is optional.
//
// "Saving the credential" in a browser means two separate things, and we do both:
//   1. the Supabase session, persisted by supabase-js so the magic link is only
//      ever needed once (persistSession: true in browser-client.ts);
//   2. a small IndexedDB record of the account this device belongs to, so the
//      app knows who it is before the network answers. IndexedDB is the browser's
//      structured, durable store — the thing you'd reach for SQLite for in a
//      native app.
//
// CRITICAL: none of this gates SOS. /api/sos does not read a session, and no
// screen will refuse to help because you are signed out.

export type Account = { email: string; signedInAt: number } | null;

export function useUser() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const settle = (e: string | null) => {
      if (!mounted) return;
      setEmail(e);
      setLoading(false);
    };

    // Local record first so the nav renders instantly, then confirm with Supabase.
    void getDeviceAccount()
      .then((a) => a && settle(a.email))
      .catch(() => settle(null));

    void sb()
      .auth.getSession()
      .then(({ data }) => {
        const e = data.session?.user?.email ?? null;
        settle(e);
        if (e) void saveDeviceAccount(e).catch(() => {});
      })
      .catch(() => settle(null));

    const { data: sub } = sb().auth.onAuthStateChange((_event, session) => {
      const e = session?.user?.email ?? null;
      settle(e);
      if (e) void saveDeviceAccount(e).catch(() => {});
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { email, loading, user: email ? { email } : null };
}

export async function signOut() {
  await clearDeviceAccount().catch(() => {});
  await sb().auth.signOut().catch(() => {});
}