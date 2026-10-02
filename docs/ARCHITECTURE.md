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

## The SOS design, in one paragraph

The press is a foreground gesture on a held device, so it never fails. Everything
*after* it can. So: generate the session uuid, write it to IndexedDB, and only then
touch the network — "fired" means persisted locally, not that a server answered.
Then `tel:`/`navigator.share` (OS-level, offline-proof), then wake lock and a
generated siren, then `watchPosition`, then *then* alert guardians. Guardian
alerting is layered: OS share sheet → Web Push → Realtime. Pinned positions are
deliberately never queued, because a stale pin misplaces her; the next
`watchPosition` tick retries on its own.

## Trust model

Capability-based, deliberately. The session uuid **is** the credential — it appears
in the guardian URL, so holding it is what grants access. Consequences: no login is
required to receive an SOS alert, and no identity is ever linked to SOS events.
`supabase/schema.sql` enables RLS on every table; `reports` has no SELECT policy at
all, so raw reports are readable only with the service key. The ceiling is uuid
secrecy, and the upgrade path is auth — recorded in `PLAN.md` §5.

## Two deliberate non-choices

**No KYC.** Linking a verified Aadhaar/DigiLocker identity to SOS timestamps and
GPS fixes would build a searchable record of when and where a woman was in danger —
a surveillance tool aimed at the victim. It also contradicts DPDP Act 2023 purpose
limitation and the deliberate no-SELECT policy on `reports`. `/login` is an optional
magic link; nothing in the SOS path checks it.

**No native app.** The one thing a PWA cannot do is fire SOS from a locked screen.
We state that limit rather than hide it, and make `tel:` the floor.

## Dependency count

Deliberately tiny. `web-push` is the only library added during Phase 2, and it earns
it: the service worker, IndexedDB wrapper, siren, and bar chart are all hand-rolled
on platform APIs. Background Sync was skipped because it is Chromium-only, and
`online` + IndexedDB is both shorter and cross-browser.
