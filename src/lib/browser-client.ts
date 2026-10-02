"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The browser-side Supabase client, anon key only. Shared by the Realtime
// subscription and sign-in so there is one place that knows the anon key is safe
// to ship and the service-role key is not.

let client: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: true } },
  );
  return client;
}