# HerGuardian — Implementation Plan

**One-liner:** HerGuardian gives women a *predictive* safety layer: it scores where you are, routes you the safest way (not the shortest), and only then does the emergency stuff — SOS, live share, recording — with every user report feeding back into the score.

Assumptions: 36h hackathon, team of 4, mobile-first PWA, fake/seeded data is fine (marked `// FAKE`).

---

## 1. Proposed solution

A **PWA + Supabase backend** with five features in one closed loop:

| Loop stage | Feature | How (lazy version) |
|---|---|---|
| **Predict** | Real-time Safety Score per location | Weighted heuristic over: crime history (seeded NCRB/public data), user reports (recency-decayed), time-of-day, lighting, crowd proxy (POI density). One function, documented weights — no ML training at the hackathon |
| **Prevent** | Safest-route recommendation | Fetch N candidate routes (OSRM), score each by aggregating cell-safety along its geometry, recommend lowest-risk; show shortest vs safest side-by-side |
| **Respond** | One-tap SOS, live location, voice trigger, auto-record, Guardian Mode | All browser-native: `tel:`/`sms:` links + Web Share, Geolocation + Supabase Realtime for guardian tracking, Web Speech API ("help me") for voice, MediaRecorder → Supabase Storage |
| **Improve** | Anonymous incident reports | One form (type + location + optional photo), no login; recency-weighted into the score |
| **Govern** | Authorities analytics dashboard | Aggregate heatmaps + hotspot trend charts from the same tables, role-gated page |

### Why this solution
1. **Reactive → predictive.** Every incumbent app is a panic button; the actual gap is *before* the incident.
2. **Browser-native = 5 features for ~free.** Voice, GPS, recording, share, push all exist in the PWA platform — no native build, demoable from a URL instantly on any judge's phone.
3. **The score is the moat and it's a loop.** Reports improve the score → better routes → users trust reports → more reports. Competitors have data silos, not loops.
4. **One dataset serves users and authorities.** The heatmap judges see is the same table the routing reads — no second system to build.
5. **Honest MVP.** A documented weighted heuristic beats an untrained "AI" — judges ask "how does your model work?" and a transparent scoring formula answers better than fake ML. ML upgrade path stays open (features are already extracted).

### Architecture

```mermaid
flowchart LR
    subgraph Client [PWA - Next.js + Tailwind + Leaflet]
        M[Map + Safety Score] --> R[Safest Route]
        M --> S[SOS / Voice / Record]
        M --> G[Guardian live view]
        M --> A[Anonymous report]
        D[Authorities dashboard]
    end
    subgraph Backend [Supabase]
        DB[(Postgres: scores,\nreports, sos_events)]
        RT[Realtime: live location]
        ST[Storage: audio/video]
    end
    OSRM[OSRM routing] --> R
    M -->|score cells| SC[Safety score fn]
    SC --> DB
    A --> DB
    DB --> M
    DB --> D
    S --> RT
    S --> ST
```

### Stack (boring, per handbook)
- **Next.js (TS) + Tailwind + shadcn/ui + MapLibre/Leaflet** — PWA, one codebase
- **Supabase** — Postgres, Auth (magic link), Realtime (guardian tracking), Storage (recordings). No custom WebSocket server.
- **OSRM** — public demo server first, self-hosted Docker profile if time allows
- **AGENTS.md rules file** — pitch, stack, look, "no new libraries without asking", "fake data marked // FAKE"

### Data model (4 tables + 1 planned — supabase/schema.sql is authoritative)

`safety_cells` (grid lat/lng + crime/report/lighting/crowd factors, `report_bumped_at` for read-time 7-day decay) · `reports` (anonymous, `seeded` flag, no public read) · `incidents` (seeded history with `source` provenance) · `guardian_sessions` (SOS session = status + latest pin + `media_paths[]`; uuid is the capability — no auth in MVP) · `push_subscriptions` (Web Push endpoints — planned for §5 step S.6, not yet in `schema.sql`). Private storage buckets `recordings`, `report-photos` (service-role only, signed URLs out). RLS: public read cells/incidents, anon insert reports/sessions, reports never publicly readable. Score stays in TS (`src/lib/safety.ts`); DB stores factors only — no PostGIS, no triggers (report→cell bump happens in `/api/report`).

---

## 2. Implementation phases (overview — detailed checklist in §4)

> §4 is the authoritative timeline. This table is the summary.

| Phase | When | Deliverable |
|---|---|---|
| **0. Skeleton** | Hour 0–1 | Pitch, core flow (3–5 steps), AGENTS.md, agreed diagram, repo + deploy pipeline |
| **1. Core loop** | Hour 1–8 | Map, seeded safety grid + score function, route scoring (shortest vs safest comparison screen) ← **the demo flow** |
| **2. Emergency** | Hour 8–16 | One-tap SOS, live share + Guardian Mode via Realtime, voice, auto-record |
| **3. Reports + Authorities** | Hour 16–24 | Anonymous report form feeding the score, hotspot heatmap, trend charts |
| **4. Polish** | Hour 24–31 | Impeccable critique, mobile-first fixes, seeded demo data, rehearse ×2 |
| **5. Freeze** | Hour 31–36 | Bug fixes only, deploy live, backup video |

**Team split (4):** frontend-map · backend/Supabase · scoring+data seed · dashboard+pitch. One agent session per person, one branch each, commit after every working step.

**Cut list (don't build):** ML training, native app, real SMS provider (use `tel:`/`sms:` links), full auth (magic link only), background SOS when tab closed (state the PWA limitation honestly), offline routing (needs a road graph), offline voice trigger (Web Speech is cloud-based). See §5.

---

## 3. Comparison with existing solutions

| Existing | What it does | Where it stops |
|---|---|---|
| **Citizen / Noonlight** (US) | Reactive incident alerts, panic button monitoring | Reports crime *after* it happens; no score, no routing |
| **bSafe** | Panic button, Follow-Me GPS share, some route features | Static; no predictive scoring from crime/lighting/crowd data |
| **My Safetipin** (India) | Safety audit scores per location — *closest to us* | Scores are **static audit snapshots**; no real-time time-of-day/crowd signal, no emergency response suite, no authority dashboard |
| **Himmat app** (Delhi Police) | SOS + GPS alerts | Mostly defunct, government-siloed, no intelligence layer |
| **Life360** | Family tracking | Tracking only; no risk prediction at all |
| **SafeCity / Guardium** | Institutional harassment/crime analytics | Built *for authorities only*; citizens get nothing |

**Why build this instead:**
1. **Nobody closes the loop.** Citizen=because-it-happened, bSafe=when-it's-happening, Safetipin=what-audit-said-last-year, SafeCity=what-authorities-see. HerGuardian is the only one where *predict → prevent → respond → improve → govern* share one data pipeline.
2. **Dynamic vs static score.** Our score changes with time of day, fresh reports, lighting and crowd — Safetipin's is a survey result that goes stale.
3. **Safest route ≠ shortest route.** Route-risk comparison is the visible "aha" for judges; most incumbents don't do it or do it statically.
4. **Citizens feed authorities and vice versa** — anonymous reports crowd-source the model while the dashboard justifies infrastructure spend, a two-sided value prop no consumer app has.
5. **It's buildable in 36h.** The differentiation is the scoring loop and routing UX, not infrastructure — hence PWA + Supabase instead of a native app we couldn't finish.

**Honest risk:** data availability (lighting/crowd aren't in OSM) — mitigate with public crime datasets (NCRB/data.gov.in, Kaggle) + POI-density proxy + seeded cells. Judges care that the *pipeline* is real and the weights are defensible.

---

## 4. Phased task plan (36h, 4 people) — authoritative timeline

**Roles (one agent session + one branch each):**
- **A — Frontend/Map:** PWA screens, Leaflet, UI
- **B — Backend:** Supabase schema, auth, Realtime, Storage, API routes
- **C — Scoring/Routing:** safety score fn, OSRM integration, seed data
- **D — Emergency UX + Dashboard + Pitch:** SOS/voice/record, authorities page, demo script

**Standing rules (from handbook):** fresh agent session per feature · one file = one owner · commit after every working step · merge to `main` often · fake data marked `// FAKE`.

### Phase 0 — Skeleton (h0–1) · everyone
| # | Task | Owner | Done when |
|---|---|---|---|
| 0.1 | Agree one-sentence pitch + 3–5 step core flow | all | written in AGENTS.md |
| 0.2 | Scaffold Next.js + Tailwind + shadcn, PWA manifest | A | `npm run dev` renders shell |
| 0.3 | Create Supabase project, wire env, magic-link auth | B | login works locally |
| 0.4 | Vercel deploy pipeline + `dev`/`main` branches | B | live URL returns 200 |
| 0.5 | Seed script stub + demo city chosen | C | `npm run seed` runs |

**Exit check:** app deployed at live URL, everyone on their branch. **Commit:** "phase 0 skeleton deployed".

### Phase 1 — Core loop (h1–8) ← *the demo flow*
| # | Task | Owner | Done when |
|---|---|---|---|
| 1.1 | Tables: `safety_cells`, `incidents`, `reports` + seed ~500 cells | B+C | rows visible in Supabase |
| 1.2 | Safety score function (weights: crime 40 / reports 25 / time 15 / lighting 10 / crowd 10) + `/api/score` | C | returns 0–100 for a lat/lng |
| 1.3 | Map screen: geolocate, heatmap layer colored by score | A | colors render on phone |
| 1.4 | OSRM fetch of 3 candidate routes + segment score aggregation | C | each route gets a risk score |
| 1.5 | Shortest-vs-safest comparison screen, safest highlighted | A | pick destination → 2 routes, scores shown |
| 1.6 | Demo script draft (pitch template) | D | ✅ `docs/DEMO.md` — 2-min script, limits, Q&A |

**Exit check:** *open app → colored map → enter destination → safest route wins* on a real phone. **Commit + deploy:** "core loop demoable".

### Phase 2 — Emergency (h8–16)
| # | Task | Owner | Done when |
|---|---|---|---|
| 2.1 | `guardian_sessions` + Realtime channel for live pins | B | two browsers share a channel |
| 2.2 | One-tap SOS flow: confirm → `sms:`/`tel:` links + guardian URL | A | SMS link opens guardian view |
| 2.3 | Guardian live-tracking page (pin follows in real time) | A | pin moves phone A → phone B |
| 2.4 | Voice trigger via Web Speech API ("help me" → SOS) | D | phrase fires SOS |
| 2.5 | Auto audio/video record → Supabase Storage | D | file appears in Storage |

**Exit check:** phone A taps SOS → phone B sees live pin + recording uploads. **Commit per feature.**

### Phase 3 — Reports + Authorities (h16–24)
| # | Task | Owner | Done when |
|---|---|---|---|
| 3.1 | Anonymous report form (type, geo, photo, no login) + anon RLS insert | A+B | report inserts without auth — ✅ RLS + form + photo all working |
| 3.2 | Reports → score pipeline (recency decay λ≈7d) | C | submitting a report changes nearby score — ✅ verified end to end |
| 3.3 | Dashboard: hotspot heatmap + top-10 risky cells | D | dashboard reads live tables — ✅ `/dashboard` |
| 3.4 | Trend chart (reports/week) + "before/after" seeded story | D | chart renders with seeded data — ✅ 12 weeks, no chart lib |

**Exit check:** submit report → score changes → dashboard hotspot moves. **Commit:** "closed loop".

### Phase 4 — Polish (h24–31)
- A: Impeccable critique + mobile-first fixes on the 3 main screens
- C: reseed demo data so the demo *always* looks good
- D: rehearse pitch ×2, record backup video (Brag plugin)
- B: verify `.env` not in git, RLS policies, dead-end/error states
- All: every diff reviewed

**Exit check:** demo runs clean twice from the live URL. **Commit:** "demo ready".

### Phase 5 — Freeze (h31–36)
- Bug fixes only, no features · final deploy · `git status` clean · backup video saved · screenshots for the channel

---

**Critical path:** 1.2 → 1.4 → 1.5 (C then A) — everything else parallelizes.
**Cut order if behind:** 3.4 chart → voice (2.4) → auto-record (2.5) → magic-link auth. Never cut: core loop + SOS.

---

## 5. SOS + offline plan (authoritative)

**Decision: local-first SOS. The network is an accelerator, never a gate.**

Supersedes §4 tasks 2.1–2.5 (mapping: S.3+S.4 → 2.1/2.2/2.3, S.7 → 2.5, S.8 → 2.4). Phase 3 tasks 3.1 UI and 3.3/3.4 (dashboard) **slip** behind this.

### Why — a panic button fails five different ways, and only one of them is the button

| # | Failure | Reality |
|---|---|---|
| 1 | No network | every `fetch("/api/sos")` fails; nothing is recorded |
| 2 | Screen off / page suspended | JS throttled or frozen — `watchPosition` stops, `MediaRecorder` stalls |
| 3 | Guardian's tab is closed | Supabase Realtime has no listener; the pin goes nowhere |
| 4 | App never installed (iOS) | iOS exposes Web Push **only** to Home-Screen web apps (16.4+) |
| 5 | Battery saver / low battery | Wake Lock denied, timers throttled |

The press itself never fails — it is a foreground gesture on a device the user is holding. So the fix is to stop everything *after* the press from depending on the network.

### Press order — each step independent of the previous one succeeding

1. **IndexedDB write first.** Never `await` a network call before it. This *is* "the button fired".
2. **`tel:` / `navigator.share` → `sms:`.** OS-level, offline-proof.
3. **Wake Lock + `AudioContext` siren.** No assets, no network. The lock dies when the tab hides — re-acquire on `visibilitychange`.
4. **`watchPosition`** → pin `PATCH` every 5s, and into IndexedDB.
5. **Then** alert guardians (Realtime / push). Best-effort; queued on failure.
6. **Flush** the outbox on `online` and on mount.

A conventional implementation does 5 before 1. That is precisely why it doesn't fire.

### Guardian channels, ranked by how often they land

| Channel | Reaches guardian with tab closed? | Needs victim's data? | Cost |
|---|---|---|---|
| `tel:` / `sms:` OS share sheet | yes | **no** | zero |
| Web Push (installed + permission granted) | yes | **no** — push is server→guardian, so a victim with no signal can still alert someone | 1 dep + VAPID + 5th table |
| Supabase Realtime **Broadcast** | no (page must be open) | yes | zero — `supabase-js` already installed |
| Real SMS via Twilio | yes | no | paid key — cut (§2) |

Realtime **Broadcast** on topic `sos:<uuid>`, not Postgres Changes — Broadcast needs no `alter publication supabase_realtime` step. The latest pin is still persisted to `guardian_sessions` for reload-safety, as `schema.sql` intends.

Guardian phone numbers are stored **on the device**, so the SOS screen's Message button is a prefilled `sms:` carrying coordinates + the `/guard/<uuid>` link — it reaches a guardian with our entire stack switched off.

### Offline capability, honestly bounded

| Feature | Offline | Why |
|---|---|---|
| Risk colouring of your area | yes | ~30KB of cells — trivial to cache |
| `tel:` / `sms:` SOS | yes | OS-level |
| Last known position | yes | kept locally regardless |
| Anonymous report | yes, queued | a report filed underground is a report that exists |
| Auto-record | record yes, upload queued | MediaRecorder is local; blob flushes on reconnect |
| **Turn-by-turn safest route** | **no** | OSRM is a network call; offline routing needs a road graph (~100MB+) |
| **Voice trigger** | **no** | Web Speech recognition is cloud-based in Chrome |

**Ceilings we state out loud:** nothing fires from a locked screen or a fully killed app — only a native build fixes that, and `tel:` is the floor. A recording is whatever reached IndexedDB before the OS froze the page.

**Pitch line:** *offline it still tells you which direction is safer and still lets you call for help; it can't route you there.*

### Tasks

| # | Task | Files | Done when |
|---|---|---|---|
| S.0 | Supabase project + schema + real seed from `buildCells()` | `.env.local`, `scripts/seed.mjs` | `/api/cells` returns `source: "db"` |
| S.1 | Offline shell | `public/sw.js`, `src/components/bootstrap.tsx`, `layout.tsx` | offline DevTools → shell renders, map still coloured from cached cells |
| S.2 | Local-first outbox | `src/lib/offline.ts` (idb + outbox + guardians + recordings) | offline report flushes on reconnect; `node --test` green |
| S.3 | Panic button | `src/app/api/sos/route.ts`, `src/app/sos/page.tsx`, `map-view.tsx` | airplane mode → tap SOS → screen + siren + `tel:`/`sms:` all work; row lands after reconnect |
| S.4 | Guardian layers | `src/lib/realtime.ts`, `src/app/guard/[id]/page.tsx`, `src/lib/map-style.ts` | phone A taps SOS → phone B pin moves; reload keeps last position |
| S.6 | Web Push | `web-push`, VAPID, `push_subscriptions` (5th table), `src/lib/push.ts` + `push-server.ts` | ✅ code complete — **needs the S.6 SQL block run in Supabase**, then guardian opts in |
| S.7 | Auto-record → Storage | `src/app/sos/page.tsx` | file appears in the `recordings` bucket |
| S.8 | Voice trigger | `src/lib/voice.ts` + toggle on the map screen ✅ "help me" / "bachao" fires SOS (online only) |

**New deps this phase:** `web-push` (approved) — nothing else. Service worker, IndexedDB wrapper, siren and share are hand-rolled on platform APIs. Background Sync is skipped: Chromium-only (no Safari, no Firefox), and `online` + IndexedDB is both shorter and cross-browser.

**New env vars:** `NEXT_PUBLIC_SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` (server-only) · `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable — safe in the browser, used by the Realtime subscription).

**Deferred by this plan:** report form UI (3.1) and the authorities dashboard (3.3/3.4). `push_subscriptions` is added to `supabase/schema.sql` when S.6 lands, not before — no speculative schema in the initial paste.

**Identity: optional login, deliberately no KYC.** A verified Aadhaar/DigiLocker identity linked to SOS timestamps and GPS fixes would build a searchable record of *when and where a woman was in danger* — a surveillance tool aimed at the victim. Every comparator in §3 avoids this, and DPDP Act 2023 requires purpose limitation. `/login` sends a Supabase magic link; nothing in the SOS path checks it, because someone in danger must never be asked to authenticate.

**False SOS is fixed without identity:** one active session per device (`localStorage` + a status check). A second tap while a session is live *reuses* it and just updates the pin, instead of opening a new session and re-alerting every guardian. A rate limit that **blocked** a second tap could kill the one call that matters, so nothing is blocked.

**Progress:** S.0–S.4, S.6 (code), S.7 **shipped**. DB is live and seeded (609 cells / 338 incidents / 40 reports; `/api/cells` reports `source: "db"`). S.5 needs no work — the S.1 SW cache already serves the grid offline. Remaining: nothing in code. S.8 shipped last because Web Speech is cloud-based and therefore offline-dead by nature.

**SOS is a toggle, not a one-shot.** Tapping SOS on the home screen starts a session; tapping again stops the alert. A second tap **reuses** the live session and just updates the pin, so a panicking double-tap cannot re-alert every guardian — and nothing is ever *blocked*, because a rate limit that suppressed a second tap could kill the one call that matters. The big red button on the SOS screen dials the **primary guardian** from the on-device list (`tel:`), falling back to `EMERGENCY` when none is configured. "I'm safe" exists on both `/sos` and the home screen.

**Checks that exist:** `npm test` (`node --test`, drain ordering) · `npm run check` (`/api/sos` 12 assertions · `/api/report` 7 · anon→anon broadcast) · `npm run reset:demo` (strip check/probe rows back out). Offline behaviour needs a real device; it has not been verified on hardware yet.

**Phone testing:** serve a **production** build — `npm run build && npm start` — and open it over **HTTPS**. A LAN IP on plain http is not a secure context: Chrome refuses geolocation outright, `crypto.randomUUID` is undefined (this is what killed the SOS page, now fixed via `newId()`), and the service worker never registers. `cloudflared tunnel --url http://localhost:3000` gives a real https URL. Details in `docs/SETUP.md`.
