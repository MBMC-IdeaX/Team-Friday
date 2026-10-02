# API

All routes are same-origin under `/api`. Every one that touches the database uses
the **service-role** client from `src/lib/db.ts`, so the key never reaches the
browser. All of them return `{ "error": "..." }` with a 4xx/5xx on bad input.

Run `npm run check` (sos + report + realtime) and `npm run check:rec` (recording)
against a running server.

---

## `GET /api/cells`

The safety grid the map colours by. 609 cells over a 0.005° lattice.

```json
{ "cells": [ { "id": 610, "lat": 27.66, "lng": 85.26,
               "crimeRisk": 0.15, "reportRisk": 0.18,
               "lighting": 0.46, "crowd": 0.96 } ],
  "source": "db" }
```

- `source` is `"db"` or `"fake"`. **`"fake"` means the database is unreachable** —
  `buildCells()` in `lib/safety.ts` is the fallback, so the demo never dies.
- `reportRisk` is already decayed 7 days from `report_bumped_at`, applied at read.
- Cached 60s in-process; `invalidateCells()` clears it on write.
- 15 KB gzipped, 70 KB raw. The service worker serves it stale-while-revalidate,
  which is what makes the overlay work offline.

## `GET /api/score?lat=&lng=`

```json
{ "score": 44, "hour": 13, "source": "db",
  "factors": { "crimeRisk": 1, "reportRisk": 0.35, "lighting": 0.52, "crowd": 0.89 } }
```

Score is 0–100, higher is safer. Weights: crime .40 / reports .25 / time .15 /
lighting .10 / crowd .10 (`lib/safety.ts`).

## `GET /api/routes?from=lat,lng&to=lat,lng`

Calls OSRM with `alternatives=true`, samples ~60 evenly-spaced points per geometry,
averages cell safety along each, then returns:

```json
{ "routes": [ { "id": 0, "duration": 512, "distance": 1840,
                "safety": 71, "coords": [[85.3,27.7], "…"] } ],
  "shortestId": 0, "safestId": 1, "hour": 22 }
```

- 400 if `from`/`to` missing or not `lat,lng`.
- 502 if OSRM is unreachable or returns no route. This is the one route with an
  external runtime dependency.
- `coords` is `[lng, lat]` GeoJSON order.

## `POST /api/report`

Anonymous. No auth, by design.

```json
{ "category": "unsafe_spot", "lat": 27.695, "lng": 85.315,
  "message": "No streetlights", "photo": "data:image/jpeg;base64,…" }
```

- `category` ∈ `harassment | unsafe_spot | poor_lighting | stalking | other` (400 otherwise).
- `message` truncated to 500 chars.
- `photo` optional data URL; **512 KB cap**. Client downscales to ~800px JPEG first.
  Uploads to the private `report-photos` bucket and stores `media_path`. The row is
  inserted *before* the upload and `media_path` is cleared if it fails — a lost
  photo never costs a report.
- Inserts the report, then **bumps the 3 nearest cells** by +0.15 `report_risk`
  (capped 0.9) and stamps `report_bumped_at`, which is the decay anchor.
- Returns `{ ok: true, bumped: 3, photo: true|false }`.
- **503 when the DB is unconfigured** — the client queues the same payload to
  IndexedDB and replays it on reconnect.

## `POST /api/sos` · `PATCH /api/sos` · `GET /api/sos?id=`

The SOS session. `id` is a uuid the **client** generates, so the guardian link works
before any network call.

| Call | Body / query | Effect |
|---|---|---|
| `POST` | `{ id, triggered_by: "tap"\|"voice", lat, lng }` | Upsert the session, then fire guardian push (not awaited) |
| `PATCH` | `{ id, lat, lng }` | Update the live pin |
| `PATCH` | `{ id, status: "ended"\|"resolved" }` | Close the session |
| `GET` | `?id=` | `{ session: { id, status, triggered_by, lat, lng, started_at, media_paths } }` |

- `POST` is an **upsert** deliberately: a replayed outbox flush after a flaky
  create must not fail.
- 400 for a non-uuid `id`, a bad `triggered_by`, non-finite coordinates, or a PATCH
  with nothing to update. 404 for an unknown session id.
- `GET` is the reload-safety path: the guardian page shows the last persisted pin
  before any live update arrives.
- Pins are **not** queued client-side. A stale pin misplaces her; the next
  `watchPosition` tick retries by itself.

## `POST /api/recording`

`multipart/form-data`: `sessionId` (uuid) + `file` (the audio chunk).

- 2 MB cap. Uploads to the private `recordings` bucket at
  `<sessionId>/<timestamp>.webm` and **appends** the path to
  `guardian_sessions.media_paths`.
- 400 for a bad `sessionId` or a missing/empty file, 413 for an oversized chunk.
- Chunks are ~10s each, written to IndexedDB first — see `lib/offline.ts`.

## `GET|POST|DELETE /api/push/subscribe` · `POST /api/push/alert`

Web Push, the only channel that reaches a guardian whose browser is closed.

| Call | Purpose |
|---|---|
| `POST /api/push/subscribe` | Store `{ endpoint, p256dh, auth, guardianId? }`. Upserts on `endpoint`, so re-subscribing can't duplicate |
| `DELETE /api/push/subscribe?endpoint=` | Remove one |
| `GET /api/push/subscribe` | `{ count }` — lets the UI show "armed" without exposing the table |
| `POST /api/push/alert` | `{ sessionId, lat?, lng? }` → `{ ok, sent }`. Manual trigger so the alert path is testable |

- 400 if `endpoint` isn't an `https://` URL or the keys are malformed.
- `GET` returns 500 when `push_subscriptions` is missing. Note: with `head: true`,
  supabase-js swallows the missing-table 404, so a `null` count is the real failure
  signal.
- Sending prunes endpoints on 404/410 and only increments `fail_count` otherwise.
- `push_subscriptions` has **no SELECT policy** — endpoints are device state, not
  something a browser should enumerate.

## `GET /api/dashboard`

The authorities view. Aggregation happens in TypeScript, not SQL: incidents +
reports are a few hundred rows, so this avoids an RPC, a view and PostGIS.

```json
{ "hour": 22,
  "stats": { "cells": 609, "incidents": 338, "reports": 40,
             "seededReports": 40, "avgScore": 65 },
  "top": [ { "id": 823, "lat": 27.695, "lng": 85.31, "score": 26,
             "reports": 1, "seeded": 1, "incidents": 2, "severity": 2 } ],
  "weekly": [ { "weekStart": 1756…, "reports": 6, "incidents": 12 } ],
  "categories": { "stalking": 11 } }
```

- `top` is the 10 **worst** cells (lowest score first), each with its incident and
  report counts attributed to that cell via the same `cellAt()` the map uses.
- `weekly` is 12 weeks, oldest first, Monday-UTC buckets so the series is stable.
- `seededReports` lets the UI state plainly how much of the history is fake.
