"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type PinPayload = { lat: number; lng: number; at: number };

// Realtime **Broadcast**, not Postgres Changes: a broadcast topic needs no
// `alter publication supabase_realtime` step, which keeps the schema honest.
//
// The topic name is the session uuid — the same capability as the guardian URL.
// Anyone holding the link can read the pin, which is the intended trust model
// (schema.sql: "uuid = capability").

let client: SupabaseClient | null = null;

function anon(): SupabaseClient {
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  return client;
}

export function joinSession(id: string, onPin: (p: PinPayload) => void) {
  const sb = anon();
  const channel = sb.channel(`sos:${id}`, { config: { broadcast: { self: false } } });
  channel.on("broadcast", { event: "pin" }, ({ payload }) => onPin(payload as PinPayload));
  channel.subscribe();
  return {
    send: (p: PinPayload) => channel.send({ type: "broadcast", event: "pin", payload: p }),
    leave: () => {
      void sb.removeChannel(channel);
    },
  };
}