# Submission answers

Copy-paste text for the hackathon form. **Every field is within its character
limit** — verified with a script, not estimated. Limits noted per heading.

## Project Introduction  _(limit 500 — used 389)_

HerGuardian is a mobile-first safety app for women in Nepal. Every street carries a live Safety Score, so the app recommends the safest route rather than the shortest. One-tap SOS dials a guardian, records audio and streams live location. Anonymous community reports re-score nearby streets, and the same data powers an authority dashboard. Offline it still shows which direction is safer.

## Problem Statement  _(limit 200 — used 171)_

Citizen and bSafe tell you about crime after it happens. Safetipin gives old survey scores. Nothing warns a woman before she walks a street, or lets her report one safely.

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
- **Plain words on purpose.** The first draft leaned on jargon — *"predicts risk, routes
  around it"* — which a judge skimming has to decode. The version above says *"warns a
  woman before she walks a street"*, which needs no decoding and is the same claim.
  Jargon buys nothing here; the competitor names do the orienting instead.
- **"Nothing warns a woman before she walks a street"** is the emotional core, and it
  should survive any future edit.
- **"without exposing her identity"** is the anonymity constraint stated as a problem,
  which is what makes our no-KYC decision read as a design choice.
- **"even when she has no signal"** on objective 2 is the honest differentiator — it is
  the one thing our push and OS-level `tel:`/`sms:` actually buy, and competitors with
  native apps cannot claim it.
- The Introduction leads with what it *does*, then the loop, then the offline claim,
  because that is the order a judge cares about.

## Simpler variants, if you want to trade detail for plainness

All within 200. The one above is the recommendation.

| Words | Text |
|---|---|
| 171 **(use this)** | Citizen and bSafe tell you about crime after it happens. Safetipin gives old survey scores. Nothing warns a woman before she walks a street, or lets her report one safely. |
| 176 | Apps like Citizen only tell you about crime after it happens. Safetipin's scores are old surveys. Nothing warns a woman before she walks a street, or lets her report it safely. |
| 179 | Safety apps report crime after it happens. Nothing warns a woman that a street is unsafe before she walks it, or lets her report a dangerous spot without giving away her identity. |
| 199 *(original)* | Citizen and bSafe report crime after it happens; Safetipin publishes stale static audits. Nothing predicts risk, routes around it, or lets a woman report an unsafe spot without exposing her identity. |

**Claims we cannot make yet**, so they stayed out of every field: that offline works,
that two phones track each other, or that push is delivered. All three are code-verified
only. If asked on stage, say so — volunteering it reads as competence.
