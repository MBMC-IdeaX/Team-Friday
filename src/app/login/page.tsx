"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { sb } from "@/lib/browser-client";

// Optional account, and deliberately optional. Nothing in the SOS path checks it:
// someone in danger must never be asked to authenticate. Signing in buys
// cross-device guardian sync and session history — not the ability to call for
// help.
//
// And explicitly NOT KYC. Linking a verified identity (Aadhaar/DigiLocker) to SOS
// timestamps and GPS fixes would build a searchable record of when and where a
// woman was in danger, which is a surveillance tool aimed at the victim. See
// PLAN.md §5.

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void sb()
      .auth.getUser()
      .then(({ data }) => {
        if (data.user) setNote(`Signed in as ${data.user.email}`);
      })
      .catch(() => {});
  }, []);

  const send = async () => {
    if (!email.trim()) return;
    setState("sending");
    const { error } = await sb().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: location.origin + "/" },
    });
    if (error) {
      setState("error");
      setNote(error.message);
      return;
    }
    setState("sent");
  };

  return (
    <main className="flex min-h-full flex-col justify-center gap-4 p-4">
      <div>
        <h1 className="text-lg font-bold">Sign in</h1>
        <p className="text-xs text-muted-foreground">
          Optional. We email you a link — no password, no KYC, no ID document.
        </p>
      </div>

      <div className="rounded-xl bg-black/70 p-4 text-xs text-muted-foreground backdrop-blur">
        <p className="mb-1 text-sm font-semibold text-foreground">What an account adds</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>Guardian list synced across your devices</li>
          <li>History of your own SOS sessions</li>
        </ul>
        <p className="mt-2">
          What it never does: block SOS. The panic button works signed out, offline, and
          without any account at all.
        </p>
      </div>

      {state === "sent" ? (
        <p className="rounded-xl bg-emerald-950/60 px-3 py-3 text-sm text-emerald-300">
          Check {email} for the sign-in link.
        </p>
      ) : (
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            type="email"
            className="flex-1 rounded-xl bg-black/70 px-3 py-3 text-sm"
          />
          <button
            onClick={send}
            disabled={state === "sending"}
            className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {state === "sending" ? "…" : "Email me a link"}
          </button>
        </div>
      )}

      {state === "error" && note && <p className="text-xs text-red-400">{note}</p>}
      {state !== "error" && note && <p className="text-xs text-muted-foreground">{note}</p>}

      <Link href="/" className="rounded-lg px-2 py-3 text-center text-xs text-muted-foreground underline">
        ← back to the map
      </Link>
    </main>
  );
}