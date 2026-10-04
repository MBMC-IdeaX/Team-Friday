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
> was persisted locally, not that a server answered."

Now on the call screen.

> "It goes straight to my contacts and dials. Then it drafts a text with my
> coordinates, starts recording, and streams my position to the guardian."

Point out the recording timer, then tap **STOP ALERT** — or **I'm safe**.

> "To stop, I tap SOS again — it's a toggle, so a second tap can't fire a new
> alert at my guardians — or I hit 'I'm safe', which resolves the session. That
> button is on the home screen too, so I never have to come back in here."

Show the home screen with **STOP ALERT** + **I'm safe**.

> "And with push armed, the guardian gets this even if their browser is closed.
> That matters because the push goes server-to-guardian — it lands even if she has
> no signal at all."

## 1:45 — Offline, on purpose

Switch to airplane mode, reopen the app.

> "No signal. The shell and the risk colouring still load — the whole safety
> grid is 15 KB over the wire and 70 KB on disk, so caching it costs nothing.
> The tiles I already panned over are still here too: we cache only what you
> actually looked at, up to 200, never a prefetch. Anything new goes grey —
> the overlay is the product."

## 1:55 — Help & rights (fast, only if time)

Tap **Help** in the bottom bar.

> "Every number here was checked against nepalpolice.gov.np or nwchelpline.gov.np
> and names its source. The nearby hospitals and police stations are queried live
> from OpenStreetMap — we deliberately did not hardcode a list, because a
> plausible-looking wrong number in a safety app is worse than no number at all."

Tap **Rights**.

> "And this is what she is legally entitled to in Nepal — eleven entries, each one
> citing its statute. You can complain to the police, the Women's Commission or your
> local body, and the police must produce the perpetrator within 24 hours. There's
> an interim protection order that can keep her in her own home. It also says where
> the law is still weak, because a system with real gaps is one you plan around."

## 2:00 — Authority view

> "One dataset, two audiences. This is the same table the routing reads. The
> heatmap is where it's bad, the top ten is ranked by current risk, and the bars
> are reports per week. So the dashboard can't drift from what users actually see."

Then point at the community-impact block.

> "And here's what the reports are worth. This is the average safety score with
> community reports counted — 60. Here it is with them removed — 68. Citizen
> reports are pulling the city average eight points lower, because they are
> surfacing risk that static crime data alone would have rated as safer. Down
> here, one report on a single junction took a street from 44 to 22."

Land on: **"citizens and authorities, one pipeline, and the citizens are the
sensor."**

Total is about 2:30 with the help section. If you're running long, cut it — the
demo is the map, the route, the report and the SOS.

---

## Honest limits — state these, don't hide them

Volunteering a limitation reads as competence; being caught on one doesn't.

| Limit | Why |
|---|---|
| Crime data is seeded | Public data is NCRB-level granularity, not street-level. The *pipeline* is real, the weights are defensible, the data is marked `// FAKE`. |
| No offline routing | OSRM is a network call. Offline routing needs a ~100MB road graph. A journey you already ran replays offline for 24h; a *new* destination needs the network. We say so. |
| Only viewed tiles are cached | No tile prefetch — the basemap survives only where you have already panned. Intentional, and it keeps the app a few hundred KB rather than a map download. |
| Voice trigger dies offline | Web Speech recognition is cloud-based. `🎙 Voice SOS` arms it, but it's the one trigger that stops working in a tunnel — hence it is last in the cut order, and the red button remains the floor. |
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
- [ ] Open `/dashboard` once beforehand to warm it — it loads on demand
- [ ] Both phones: location permission granted, airplane mode tested
- [ ] `/help` will only load nearby facilities **online** — the hotlines work regardless
- [ ] Bottom bar (Map · Guardians · Rights · Help) is how you move between sections
- [ ] Guardians pre-added on phone A, so the big red button dials a person and not the fallback number
- [ ] Try SOS → STOP ALERT → SOS once, so the toggle is muscle memory
- [ ] Backup video recorded
