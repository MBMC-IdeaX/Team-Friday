# HerGuardian

Predictive women's safety. It scores where you are, routes you the **safest** way
rather than the shortest, and only then does the emergency work — SOS, live
guardian tracking, recording — with every user report feeding back into the score.

The loop: **Predict → Prevent → Respond → Improve → Govern.**

## Try it

```bash
npm install
cp .env.local.example .env.local     # then paste your Supabase keys
# paste supabase/schema.sql into the Supabase SQL editor and run it
npm run seed                          # 609 cells, 338 incidents, 40 reports
npm run build && npm start            # production — required for phone testing
```

Full detail in **[docs/SETUP.md](docs/SETUP.md)**. Read the HTTPS section before
testing on a phone: a LAN IP over plain http is not a secure context, so Chrome
withholds geolocation and the service worker will not register.

## What's built

| | Feature |
|---|---|
| **Predict** | 0–100 Safety Score per grid cell from crime, community reports, time of day, lighting and crowd — a published weighted heuristic, no black box |
| **Prevent** | OSRM alternatives, each scored by averaging cell safety along its geometry — **shortest vs safest** side by side |
| **Respond** | One-tap SOS that persists locally *before* any network call, dials your primary contact, records audio in chunks, and streams a live pin to the guardian. SOS is a **toggle**; "I'm safe" resolves the session |
| **Improve** | Anonymous reports with an optional photo, which bump the nearest cells and decay over 7 days at read time |
| **Govern** | `/dashboard` — hotspot heatmap, top-10 riskiest cells, weekly trend. Reads the same tables routing reads |

Plus: offline app shell and cached safety grid, Web Push (the only channel that
reaches a guardian whose browser is closed), and an optional magic-link sign-in
that **never gates SOS**.

## Design decisions worth knowing

**No KYC, deliberately.** Linking a verified Aadhaar/DigiLocker identity to SOS
timestamps and GPS fixes would build a searchable record of *when and where a
woman was in danger* — a surveillance tool aimed at the victim. It also
contradicts DPDP Act 2023 purpose limitation. There is an optional magic link for
guardian sync; nothing in the SOS path checks it.

**The uuid is the credential.** No login is required to receive an SOS alert.
`reports` has no `SELECT` policy at all, so raw reports are readable only with the
service key.

**The network is an accelerator, never a gate.** The panic button writes to
IndexedDB before it touches a server, so "fired" means persisted locally rather
than that someone answered.

**Nothing is ever blocked.** A second tap while a session is live reuses it and
just updates the pin, so a panicking double-tap cannot re-alert every guardian.
A rate limit that *suppressed* a second tap could kill the one call that matters.

## Honest limits

- **Crime data is seeded**, marked `// FAKE`. The pipeline and the weights are
  real; the history is fabricated. Stating this beats being caught on it.
- **Nothing fires from a locked screen.** Native-only. `tel:` is the floor, and
  it's why the call button is a real `tel:` link.
- **No offline routing.** OSRM is a network call; offline routing needs a ~100MB
  road graph. Offline still tells you which direction is safer.
- **Voice trigger needs a network.** Web Speech recognition is cloud-based, so the
  one trigger you'd want in a tunnel is the one that stops working there.
- **Offline, two-phone tracking and browser push are code-verified only.** No one
  has run them on hardware yet.

## Verification

```bash
npm test         # node:test, no framework — drain ordering + voice phrase matcher
npm run lint
npm run check    # /api/sos (12) · /api/report (7) · Realtime broadcast (needs a server)
npm run check:rec  # /api/recording upload + media_paths
npm run reset:demo  # strip check/probe rows and orphaned uploads back out
```

Everything is asserted against the real Supabase project, not mocks.

## Stack

Next.js 16 (App Router, TS) · Tailwind v4 · MapLibre GL · Supabase (Postgres,
Realtime, Storage) · OSRM · `web-push`. The service worker, IndexedDB layer,
siren and bar charts are hand-rolled on platform APIs — `web-push` is the only
dependency added after the scaffold.

## Docs

| | |
|---|---|
| [docs/DEMO.md](docs/DEMO.md) | The 2-minute demo script, honest limits, and prepared Q&A |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it fits together and why |
| [docs/API.md](docs/API.md) | All routes, status codes, and the traps |
| [docs/DATABASE.md](docs/DATABASE.md) | Tables, RLS matrix, buckets, conventions |
| [docs/SETUP.md](docs/SETUP.md) | Clone → working phone test |
| [PLAN.md](PLAN.md) | The 36-hour plan, phases, and cut list |
| [AGENTS.md](AGENTS.md) | Pitch, stack, house rules |
