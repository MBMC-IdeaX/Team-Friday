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
6. Need help? → /help has verified police/ambulance/women's helplines plus live
   nearby facilities from OpenStreetMap. /rights explains what she is legally
   entitled to in Nepal, with the law cited for each claim.
7. Authorities open /dashboard → same tables, hotspot heatmap, and what community
   reports changed.

# Navigation
Bottom bar on every screen except /sos: Map · Guardians · Rights · Help.
The route-group layouts in `src/app/` own it, so no page is a dead end you cannot
leave. Choose chrome by route group, never by branching on `usePathname()` during
render — that is what caused a hydration mismatch.

# Content with consequences
Phone numbers and legal claims are never written from memory. Every entry in
`src/lib/emergency.ts` names its source (nepalpolice.gov.np, nwchelpline.gov.np)
and every right on /rights cites its statute and section. Nearby facilities come
live from OpenStreetMap rather than a hardcoded list, precisely so we never invent
a number someone might dial in a crisis. If you add a number, add its source.

# Checks
`npm test` (no framework) · `npm run check` + `npm run check:rec` (need a running
server) · `npm run reset:demo` before a demo. Docs: docs/SETUP.md, docs/DEMO.md.

# Pitch
`presentation.html` — 12-slide animated deck. Open it in a browser; no build step
and no network requests, so it survives the wifi dropping. ←/→ or click to advance,
F for fullscreen. It states our limits out loud on slide 10 — do not cut that slide.

`herguardian-deck.html` — the 7-slide Team Friday deck: hero, problem, solution,
demo video, **competitor comparison** (PLAN.md §3), stack, close. Same arrow
controls. It pulls Google Fonts, so open it while the wifi still works.
