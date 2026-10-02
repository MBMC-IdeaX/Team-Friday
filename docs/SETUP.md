# Setup

## 1. Requirements

- **Node with native TypeScript support.** We rely on two things that need it:
  type stripping, so `scripts/seed.mjs` imports `src/lib/safety.ts` directly with
  no build step (unflagged from Node 23.6, backported to 22.18), and
  `process.loadEnvFile`, so there is no `dotenv` dependency. Verified on Node 26.
  If you see `MODULE_TYPELESS_PACKAGE_JSON` warnings from the seed, your Node is
  too old — everything else still works.
- A free [Supabase](https://supabase.com) project.

## 2. Install

```bash
npm install
```

## 3. Database

1. New project at supabase.com.
2. SQL editor → paste **all** of `supabase/schema.sql` → Run. It creates 4 tables,
   RLS policies, and the two private storage buckets.
3. Run the **S.6 block at the bottom of the file** too (Web Push) — it creates
   `push_subscriptions`. Until you do, `GET /api/push/subscribe` returns 500 with a
   message saying so.
4. Confirm `/api/cells` reports `"source": "db"` once the app is running. If it
   says `"fake"`, the env vars are wrong or the tables are missing.

No Supabase CLI needed. If you have the direct connection string
(Settings → Database), `psql "<uri>" -f supabase/schema.sql` also works.

## 4. Environment

Create `.env.local` in the repo root:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...     # the service_role key
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... # the anon / publishable key
NEXT_PUBLIC_VAPID_PUBLIC_KEY=B...    # from: npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY=...                # server-only, never NEXT_PUBLIC_
```

- `.env*` is gitignored. **Never commit the service-role key** — it bypasses RLS
  and can read the `reports` table, which has no public SELECT policy by design.
- `SUPABASE_SERVICE_ROLE_KEY` has **no** `NEXT_PUBLIC_` prefix on purpose: that is
  what keeps it server-side. All DB access goes through `/api/*`; the browser
  never talks to Supabase directly.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the publishable key. Safe in the browser —
  it is what the Realtime subscription and `/login` use.
- The VAPID **public** key is safe to ship; the **private** key is not. Push only
  works on HTTPS, and on iOS only from a Home Screen web app.

## 5. Seed

```bash
npm run seed     # 609 cells, 338 incidents, 40 seeded reports
```

Re-runnable. It wipes only demo-owned rows (`reports` where `seeded = true`), so
real SOS sessions and real reports survive a reseed. Incidents and reports are
*derived* from the same `buildCells()` grid the app falls back to, so the map
looks identical whether it reads the DB or the FAKE fallback.

## 6. Run

```bash
npm run dev                  # development
npm run build && npm start   # production — use this for phone testing
```

## 7. Test on a phone — read this

**Use a production build over HTTPS.** Opening `http://192.168.x.x:3000` looks
like it works and then fails in ways that are hard to read, because a private IP
on plain http is **not a secure context**:

| Symptom over plain http | Cause |
|---|---|
| SOS page blank after tapping SOS | `crypto.randomUUID` is `[SecureContext]` and undefined — fixed via `newId()` in `src/lib/offline.ts` |
| Live pin never moves | Chrome refuses geolocation on insecure origins: *"Only secure origins are allowed"* |
| Offline mode does nothing | Service workers require a secure context, so `/sw.js` never registers |
| Guardian push impossible | Web Push needs HTTPS, and on iOS an installed Home-Screen app on top |

Get a real HTTPS URL locally — no deploy needed:

```bash
cloudflared tunnel --url http://localhost:3000
```

Then `npm run build && npm start`, and open the tunnel URL on the phone. Note
that `npm run dev` is a poor phone-test target: the service worker is registered in
production only, and dev-mode HMR churn makes the caching paths lie.

To test the offline path: load the app once over HTTPS, switch the phone to
airplane mode, then reopen. The shell and the safety grid should still render.
**Basemap tiles will not** — OSM tiles are deliberately not cached, so the map
greys out and the risk overlay remains. That is the intended trade, recorded in
`PLAN.md` §5.

`EMERGENCY` in `src/app/sos/page.tsx` is the fallback the red button dials when no
guardian is configured. Once you add a guardian on the SOS screen, the button dials
**that person** instead. Change the constant for your region.

Permissions the phone will ask for, and when:

| Permission | Asked when | Without it |
|---|---|---|
| Microphone | Tapping `🎙 Voice SOS` | Voice trigger unavailable; SOS still works |
| Microphone | SOS screen opens | No recording, everything else works |
| Notifications | Guardian taps "Alert me even if this tab is closed" | No push; guardians still get live tracking while their page is open |
| Location | SOS screen opens, and the map's geolocate button | No live pin |

The call button, the SMS and the local session write do not depend on any of those
prompts succeeding — a denied microphone costs you the recording, not the alert.
Recording and location failures are reported on the SOS screen rather than hidden.

## 8. Checks

```bash
npm test          # node:test, no framework — drain ordering
npm run lint
npm run check     # /api/sos + /api/report + Realtime broadcast (needs a running server)
npm run check:rec  # /api/recording upload + media_paths
npm run reset:demo  # strip check/probe rows back out of the DB
```

`npm run check` writes to the real database, so run `npm run reset:demo` before a
demo. Verified in a production build: `/api/sos` (12 assertions), `/api/report`
(7, including photo upload and rejection), and an anon→anon broadcast actually
delivering a pin.

## Troubleshooting

| Problem | Cause |
|---|---|
| `"source": "fake"` from `/api/cells` | env vars missing/wrong, or schema not pasted, or the table is empty |
| `/api/report` returns 503 | `dbConfigured()` is false — service-role key missing |
| Broadcast never delivers | Check `npm run check`; a raw `phx_join` returning `status:"ok"` means the transport is fine and the problem is the client |
| Map is black / zero height | The map container is `position:absolute; inset:0` inside a `flex-1` parent — it needs a resolved parent height (this bit us once, commit `63ed642`) |
| A page is blank with no error | Should not happen — `src/app/error.tsx` catches and prints the message. If you see a blank page anyway, that is a bug worth reporting |
