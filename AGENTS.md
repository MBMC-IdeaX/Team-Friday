# Project
HerGuardian helps women stay safe by predicting risk before it happens: real-time Safety Scores, safest (not shortest) routes, one-tap SOS with live guardian tracking, and community reports that improve the score.

# Stack
Next.js (TypeScript), Tailwind, shadcn/ui, MapLibre/Leaflet. Backend: Supabase (Postgres, Auth magic link, Realtime, Storage). Routing: OSRM. Deploy on Vercel. Full plan: see PLAN.md.

# Look
Mobile-first PWA, dark theme, brand color #1b7a86, font Inter, shadcn/ui.

# Rules
- Keep it simple. No new libraries without asking.
- Fake data is fine; mark it with // FAKE.
- Never put API keys in code. Use .env.local.
- Commit after every working step.

# Core flow (3–5 steps)
1. Open app → map colored by Safety Score.
2. Enter destination → see shortest vs safest route with risk scores.
3. Pick safest → navigate with live score updates.
4. Danger? One-tap SOS (or voice) → guardians see live pin + recording.
5. Report an unsafe spot anonymously → score improves for everyone.
