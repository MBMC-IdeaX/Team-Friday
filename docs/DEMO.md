# Demo — 2 minutes

**One line:** HerGuardian predicts where it's unsafe and routes you the safest way,
*before* anything happens.

> Everything below is spoken while the app runs. Timings are cumulative.
> Rehearse it twice. Record a backup video before you demo (PLAN.md Phase 4).

---

## 0:00 — Open on the map (already coloured)

> "Everywhere on this map is scored 0 to 100, live. Green is safe, red is dangerous.
> That's Kathmandu. These are real database rows, and the data is synthetic — the
> pipeline isn't."

**Say before anyone asks:** the crime data is seeded, marked `// FAKE` in the code.
The *scoring* is real and the weights are published in `src/lib/safety.ts`.

## 0:20 — Pick a destination, watch shortest vs safest

> "Here's the thing no one else does. I'm going from here to here. This is the
> shortest route. And this is the safest route. Notice they're different — the
> fastest way is 3 minutes through an unlit stretch. We sample about 60 evenly
> spaced points along each route's geometry and average the cell safety across
> them, with the time of day folded into the score."

Tap the map, let the two cards render, point at the different colours.

## 0:50 — The differentiator: reports change the map

> "Now the part that makes it a loop and not a static audit. I'm reporting this
> junction. Anonymous — no login, no tracking. Submit."

Hit **Report a spot** → pick a category → submit.

> "Those three nearby cells just went up in risk. That's the 7-day decay
> re-applying at read time — no background jobs. Somebody's report is now changing
> the route that other women are given."

**This is the moment the pitch turns on.** The score is not a survey result.

## 1:20 — SOS, on two phones

Phone A taps **SOS**; phone B is on the Guardian link.

> "One tap. No confirmation dialog — latency kills panic buttons. The session is
> written to the phone *first*, before any network call. So 'SOS fired' means it
> was persisted locally, not that a server answered. Then: it dials, it drafts a
> text with her coordinates, it starts recording, and it starts streaming her
> position to the guardian."

Point out the recording timer, the live pin on phone B.

> "And with push armed, the guardian gets this even if their browser is closed.
> That matters because the push goes server-to-guardian — it lands even if she has
> no signal at all."

## 1:45 — Offline, on purpose

Switch to airplane mode, reopen the app.

> "No signal. The shell and the risk colouring still load — the whole safety
> grid is 15 KB over the wire and 70 KB on disk, so caching it costs nothing.
> The basemap goes grey, because we deliberately
> don't cache map tiles. The overlay is the product."

## 1:55 — Authority view

> "One dataset, two audiences. This is the same table the routing reads. The
> heatmap is where it's bad, the top ten is ranked by current risk, and the bars
> are reports per week. So the dashboard can't drift from what users actually see."

Land on: **"citizens and authorities, one pipeline."**

---

## Honest limits — state these, don't hide them

Volunteering a limitation reads as competence; being caught on one doesn't.

| Limit | Why |
|---|---|
| Crime data is seeded | Public data is NCRB-level granularity, not street-level. The *pipeline* is real, the weights are defensible, the data is marked `// FAKE`. |
| No offline routing | OSRM is a network call. Offline routing needs a ~100MB road graph. We say so. |
| Voice trigger dies offline | Web Speech is cloud-based. It's the last thing we built, for that reason. |
| Nothing fires from a locked screen | That's native-only. `tel:` is the floor, and it's why the red button is a `tel:` link and not just an API call. |
| Guardian must open the app for live tracking | Push fixes this, but only once installed and granted. |

---

## Q&A — prepare these five

**"How does your model work?"**
Not a model. A published weighted heuristic: crime 40 / reports 25 / time-of-day
15 / lighting 10 / crowd 10 (`src/lib/safety.ts`). Every factor is inspectable, and
the features are already extracted if someone wants to train something real later.
A documented heuristic beats an untrained "AI" you can't explain.

**"Isn't this just a static audit like Safetipin?"**
Theirs is a survey snapshot that goes stale. Ours moves with time of day, fresh
reports, lighting and crowd, and user reports feed it back. Safetipin is in
`PLAN.md` §3 as our closest comparator precisely because it isn't dynamic.

**"Do you verify the user's identity?"**
No, deliberately. Linking a verified Aadhaar to SOS timestamps and GPS fixes would
build a searchable record of when and where a woman was in danger — a surveillance
tool aimed at the victim. There's an optional magic-link sign-in for guardian sync,
and nothing in the SOS path checks it. If a judge pushes on KYC, this is your
strongest answer, not your weakest.

**"What stops someone spamming false SOS?"**
One active session per device: a second tap reuses the live session and just updates
the pin, so it doesn't re-alert guardians. And nothing is ever *blocked* — a rate
limit that suppressed a second tap could kill the one call that matters.

**"Why a PWA and not a native app?"**
It's a 36-hour build. A PWA is demoable from a URL on any judge's phone, and the
browser already gives us GPS, microphone, speech, share and push. The one thing we
give up is background SOS when the tab is dead, and we state that limit rather than
hide it.

---

## Pre-flight

- [ ] `npm run build && npm start` — **production**, so the service worker registers
- [ ] Open over **HTTPS** (`cloudflared tunnel --url http://localhost:3000`) or geolocation is dead
- [ ] `npm run reset:demo && npm run seed` — clean tables before you present
- [ ] Both phones: location permission granted, airplane mode tested
- [ ] Guardians pre-added on phone A so the text button is populated
- [ ] Backup video recorded
