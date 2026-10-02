# Project
HerGuardian helps women stay safe by predicting risk before it happens: real-time Safety Scores, safest (not shortest) routes, one-tap SOS with live guardian tracking, and community reports that improve the score.

# Stack
Next.js 16 App Router (TypeScript), Tailwind v4, MapLibre GL. Backend: Supabase (Postgres, Realtime Broadcast, Storage, optional magic-link auth). Routing: OSRM. Push: `web-push`. Deploy on Vercel. Full plan: see PLAN.md.

# Look
Mobile-first PWA, dark theme, brand color #1b7a86, font Inter.

# Rules
- Keep it simple. No new libraries without asking.
- Fake data is fine; mark it with // FAKE.
- Never put API keys in code. Use .env.local (copy .env.local.example).
- Commit after every working step.
- Never leave a screen in a dead end. An unknown id, a failed fetch or a blocked
  API must say so and offer a way out — not sit on "Loading…" forever.

# Non-negotiables
These are the product, not implementation details. Do not "improve" them away.
- **SOS must never require login, network, or a permission prompt.** It writes
  locally before it touches a server, so "fired" means persisted.
- **Never block a second tap.** Reuse the live session and update the pin instead.
  A rate limit that suppresses the second press could kill the one call that matters.
- **No KYC.** Linking a verified identity to SOS timestamps and GPS builds a record
  of when and where a woman was in danger. Optional magic link only.
- **The uuid is the credential.** Holding a guardian link grants access by design.
- **Say the limits out loud** rather than letting a judge find them. docs/DEMO.md
  has the list and the prepared answers.

# Core flow (3–5 steps)
1. Open app → map colored by Safety Score.
2. Enter destination → see shortest vs safest route with risk scores.
3. Pick safest → navigate with live score updates.
4. Danger? One-tap SOS → dials your contact, records audio, guardians see a live
   pin. Tap SOS again, or "I'm safe", to stand down. Voice ("help me" / "bachao")
   arms as a hands-free alternative.
5. Report an unsafe spot anonymously → score changes for everyone.
6. Authorities open /dashboard → same tables, hotspot heatmap, and what community
   reports changed.

# Checks
`npm test` (no framework) · `npm run check` + `npm run check:rec` (need a running
server) · `npm run reset:demo` before a demo. Docs: docs/SETUP.md, docs/DEMO.md.
