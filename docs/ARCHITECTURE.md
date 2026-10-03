# Architecture

## Shape

A mobile-first PWA. One Next.js codebase, one Supabase project, one public OSRM
server. No native build, no custom WebSocket server, no ML.

```
PWA  ── fetch ──▶  /api/*        (service-role, server-only)
                     │
                     ├─▶ Postgres      safety_cells · incidents · reports
                     │                 guardian_sessions · push_subscriptions
                     ├─▶ Storage       recordings · report-photos   (both private)
                     └─▶ Supabase Realtime  Broadcast on topic `sos:<uuid>`

PWA  ──▶ OSRM router  (only network dependency outside our own stack)
```

## The one rule everything follows

**The browser never talks to Supabase directly.** All database access goes through
`/api/*`, so the service-role key stays on the server. Anonymous writes are
validated inside the route. This is why `NEXT_PUBLIC_SUPABASE_ANON_KEY` is only
ever used for two things: the Realtime subscription and sign-in.

## Where the score lives

Not in the database. `safety_cells` stores only *factors* (crime, reports,
lighting, crowd) and the score is computed at read time in `src/lib/safety.ts`,
shared verbatim by the server routes and the client. Consequences worth knowing:

- No PostGIS, no triggers, no cached score to go stale.
- Recency decay is a `exp(-days/7)` multiply on read, so **no background jobs
  exist anywhere in this codebase**.
- The same function runs on phone and server, so numbers always agree.

## The five parts, and where they live

| Part | Server | Client |
|---|---|---|
| Safety score | `lib/safety.ts` | same file, imported directly |
| Grid data | `api/cells` + `lib/db.ts` | `map-view.tsx` |
| Safest route | `api/routes` (OSRM) | `map-view.tsx` |
| SOS session | `api/sos`, `api/recording`, `lib/push-server.ts` | `sos/page.tsx` |
| Guardian view | `api/sos` (GET) + Realtime | `guard/[id]/page.tsx` |
| Reports | `api/report` | `report-sheet.tsx` |
| Dashboard | `api/dashboard` | `dashboard-view.tsx` |
| Offline | `public/sw.js` + `lib/offline.ts` | `bootstrap.tsx` |
| Audio recording | `api/recording` | `sos/page.tsx`, `lib/offline.ts` |
| Push alerts | `lib/push-server.ts`, `api/push/*` | `lib/push.ts`, `guard-tracker.tsx` |
| Voice trigger | — | `lib/voice.ts` |
| Navigation | — | `components/shell.tsx` → `nav.tsx` |
| Account | Supabase Auth | `lib/user.ts`, `app/login/page.tsx` |
| Guardians (on-device) | — | `app/guardians/page.tsx`, `lib/offline.ts` |
| Rights content | — | `app/rights/page.tsx` |
| Emergency data | — | `lib/emergency.ts`, `app/help/page.tsx` |
| Place search | — | `components/place-search.tsx` (Nominatim) |
| Audio recording | `api/recording` | `sos/page.tsx`, `lib/offline.ts` |
| Push alerts | `lib/push-server.ts`, `api/push/*` | `lib/push.ts`, `guard-tracker.tsx` |
| Voice trigger | — | `lib/voice.ts` (client only) |

## The SOS design, in one paragraph

The press is a foreground gesture on a held device, so it never fails. Everything
*after* it can. So: generate the session uuid, write it to IndexedDB, and only then
touch the network — "fired" means persisted locally, not that a server answered.
Then `tel:`/`navigator.share` (OS-level, offline-proof), then wake lock and a
generated siren, then `watchPosition`, then *then* alert guardians. Guardian
alerting is layered: OS share sheet → Web Push → Realtime. Pinned positions are
deliberately never queued, because a stale pin misplaces her; the next
`watchPosition` tick retries on its own.

## Two toggles, and why neither blocks anything

**SOS is a toggle.** Tapping it on the home screen opens a session; tapping again
stops the alert. If a session is already live, a second tap *reuses* it and only
updates the pin, so a panicking double-tap cannot re-alert every guardian. The
active uuid lives in `localStorage`, re-read on mount and whenever the tab regains
focus so a session finished in another tab is reflected here, and "I'm safe"
resolves the session from either screen.

**Voice is a toggle too.** `🎙 Voice SOS` arms Web Speech, and it only ever starts
from a click, because recognition will not start without a gesture. On a match it
routes into `/sos` — so it inherits every reliability property already built
there rather than re-implementing any of them. The phrase matcher is deliberately
narrow (`help me`, `bachao`, `sos`, …): a false alert trains guardians to ignore
alerts, which is worse than no voice trigger.

Neither toggle can refuse to fire. Anything that *blocks* the second press could
kill the one call that matters.

## Trust model

Capability-based, deliberately. The session uuid **is** the credential — it appears
in the guardian URL, so holding it is what grants access. Consequences: no login is
required to receive an SOS alert, and no identity is ever linked to SOS events.
`supabase/schema.sql` enables RLS on every table; `reports` has no SELECT policy at
all, so raw reports are readable only with the service key. The ceiling is uuid
secrecy, and the upgrade path is auth — recorded in `PLAN.md` §5.

## Client-side third-party APIs

Two free, keyless services are called from the browser rather than proxied. Both
degrade to a stated fallback instead of a broken screen:

| Service | Used for | Why client-side |
|---|---|---|
| OpenStreetMap **Nominatim** | place search | debounced 600ms, min 3 chars, per their usage policy |
| OpenStreetMap **Overpass** | nearby police/hospitals on `/help` | Overpass requires a real `User-Agent`; a server proxy would have to set one, and a browser already sends it |

Keeping these in the client means zero server cost and no API keys, but it also
means **they only work online.** `/help` is explicit about that: the verified
national hotlines above them work regardless.

## Where content with consequences lives

`lib/emergency.ts` is the only place a phone number may be written, and every
entry names the official source it was checked against. `/rights` follows the same
rule for law: each entry cites its statute and section. Nearby facilities are
queried live rather than hardcoded — a plausible-looking wrong number in a safety
app is worse than no number at all.

## Two deliberate non-choices

**No KYC.** Linking a verified Aadhaar/DigiLocker identity to SOS timestamps and
GPS fixes would build a searchable record of when and where a woman was in danger —
a surveillance tool aimed at the victim. It also contradicts DPDP Act 2023 purpose
limitation and the deliberate no-SELECT policy on `reports`. `/login` is an optional
magic link; nothing in the SOS path checks it.

**No native app.** The one thing a PWA cannot do is fire SOS from a locked screen.
We state that limit rather than hide it, and make `tel:` the floor. Note also that
the call button is a deliberate extra tap rather than auto-dial: browsers refuse
`tel:` without a gesture, and auto-navigating away would kill the recording.

**Web Speech last.** Recognition in Chrome is cloud-based, so voice is the one
trigger that stops working in a tunnel. Built last, on purpose.

## Dependency count

Deliberately tiny. `web-push` is the only library added after the scaffold, and it earns
it: the service worker, IndexedDB wrapper, siren, and bar chart are all hand-rolled
on platform APIs. Background Sync was skipped because it is Chromium-only, and
`online` + IndexedDB is both shorter and cross-browser.
