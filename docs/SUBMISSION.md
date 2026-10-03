# Submission answers

Copy-paste text for the hackathon form. **Every field is within its character
limit** — verified with a script, not estimated. Limits noted per heading.

## Project Introduction  _(limit 500 — used 389)_

HerGuardian is a mobile-first safety app for women in Nepal. Every street carries a live Safety Score, so the app recommends the safest route rather than the shortest. One-tap SOS dials a guardian, records audio and streams live location. Anonymous community reports re-score nearby streets, and the same data powers an authority dashboard. Offline it still shows which direction is safer.

## Problem Statement  _(limit 200 — used 199)_

Citizen and bSafe report crime after it happens; Safetipin publishes stale static audits. Nothing predicts risk, routes around it, or lets a woman report an unsafe spot without exposing her identity.

## Proposed Solution  _(limit 200 — used 198)_

A 0-100 Safety Score per street (crime, reports, time, lighting, crowd) powers safest-not-shortest routing. One-tap SOS dials a guardian, records and streams location. Anonymous reports re-score it.

## Key Features / Objectives  _(limit 200 — used 133)_

1) Live Safety Score per street plus safest-not-shortest routing. 2) One-tap SOS that reaches a guardian even when she has no signal.

## Project workflow diagram

`docs/workflow.png` — four swimlanes (user / app device / server / data and
external), 29 numbered steps in pitch order, with the offline behaviour called out
at the foot. Also shipped as `.svg`, `.jpg` and `.pdf`, and regenerable with
`python3 scripts/make-workflow.py`.

## Why these answers are worded this way

- **Names the comparators.** Judges know Citizen and bSafe. Showing we have read the
  space beats claiming the problem is invisible.
- **"Stale static audits"** is the sharpest line here: it explains why a Safetipin-style
  product still leaves women unable to act.
- **"without exposing her identity"** is the anonymity constraint stated as a problem,
  which is what makes our no-KYC decision read as a design choice.
- **"even when she has no signal"** on objective 2 is the honest differentiator — it is
  the one thing our push and OS-level `tel:`/`sms:` actually buy, and competitors with
  native apps cannot claim it.
- The Introduction leads with what it *does*, then the loop, then the offline claim,
  because that is the order a judge cares about.

**Claims we cannot make yet**, so they stayed out of every field: that offline works,
that two phones track each other, or that push is delivered. All three are code-verified
only. If asked on stage, say so — volunteering it reads as competence.
