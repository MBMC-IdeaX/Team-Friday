# Database

Postgres via Supabase. `supabase/schema.sql` is authoritative — paste the whole
file into the SQL editor on a new project.

**Deliberately minimal: five tables, no PostGIS, no triggers, no background jobs.**
The score is computed in TypeScript at read time, so the database only ever stores
*factors*. See `ARCHITECTURE.md` for why.

Current demo state: 609 cells · 338 incidents · 40 seeded reports · 0 sessions.

---

## Tables

### `safety_cells` — the grid

One row per 0.005° lattice point over the demo city (21 × 29 = 609).

| Column | Notes |
|---|---|
| `id` | `bigint identity` — **do not supply a value on insert** |
| `lat`, `lng` | Indexed together via `safety_cells_loc_idx` |
| `crime_risk` | 0–1, `check` constrained |
| `report_risk` | 0–1, `check` constrained. Decayed at read, not on write |
| `report_bumped_at` | Decay anchor. `null` = never reported |
| `lighting` | 0–1, 1 = well lit (OSM `street_lamp` density) |
| `crowd` | 0–1, 1 = busy (OSM POI density) |
| `updated_at` | `now()` default |

The `check (… between 0 and 1)` constraints are a real trust boundary — `/api/report`
bumps `report_risk` with arithmetic and a 0.9 cap, and the DB refuses anything silly.

### `incidents` — seeded history

`category` ∈ `harassment | theft | assault | other`, `severity` 1–3, `occurred_at`,
and `source` (default `'seed-fake'`) for **provenance**. Always know which rows are
fabricated; the demo script says so out loud.

### `reports` — fully anonymous

`category` ∈ `harassment | unsafe_spot | poor_lighting | stalking | other`,
optional `message` (truncated to 500 chars server-side) and `media_path` — an
**object path, not a public URL**.

`seeded boolean` marks demo history, which is how `npm run reset:demo` deletes
check/probe rows without touching real submissions, and how the dashboard states
how much of the data is fake.

> **This table has no `SELECT` policy.** Raw reports are readable only with the
> service-role key. That is the point: crowd-sourced reports about harassment are
> not something any client should be able to enumerate.

### `guardian_sessions` — the SOS session

| Column | Notes |
|---|---|
| `id` | `uuid`, **supplied by the client** so the guardian link works offline |
| `status` | `active | ended | resolved` |
| `triggered_by` | `tap | voice` |
| `lat`, `lng` | Latest pin. Written every ~5s while the session is live |
| `media_paths` | `text[]` of recording object paths, appended per chunk |
| `started_at` / `expires_at` | Expires after 1 hour by default |

The uuid **is** the credential — the guardian URL is `/guard/<uuid>`, so holding the
link is what grants access. That is the whole auth model, and it is the reason no
identity is ever attached to an SOS.

### `push_subscriptions` — Web Push endpoints (S.6)

`endpoint` (unique, so re-subscribing upserts rather than duplicates), `p256dh`,
`auth`, optional `guardian_id` and `user_id`, plus `last_ok_at` and `fail_count`.

> Also **no `SELECT` policy**. A push endpoint is device state, and a browser should
> never be able to enumerate them. All access is service-role from `/api/push`.
> Send failures prune on 404/410, so dead endpoints self-clean.

## Row Level Security

RLS is enabled on every table. Read policies exist only where a client genuinely
needs to read:

| Table | Read | Write |
|---|---|---|
| `safety_cells` | public `select` | service role only |
| `incidents` | public `select` | service role only |
| `reports` | **none** | anon `insert` (with check `true`) |
| `guardian_sessions` | **none** (service role only) | anon `insert` |
| `push_subscriptions` | **none** | service role only |

The capability model is the ceiling: **`uuid` secrecy, not authentication.** Anyone
holding a session uuid can read and move that session's pin. The upgrade path is
auth, recorded in `PLAN.md` §5.

`guardian_sessions` has **no select policy at all**, and that is a correction, not an
oversight. It originally carried `for select using (true)` — which reads like a
capability gate but is the opposite of one: it would let any client enumerate every
live SOS session and read its pin. It was inert only because the `anon` role has no
`SELECT` grant, which is luck rather than design. Nothing needs anon reads, since
`/api/sos` uses the service role and the browser's Realtime Broadcast does not
consult RLS on this table. Verified against the live database: anon sees 0 rows from
`reports` *and* from `guardian_sessions`.

## Storage buckets

Both **private** (`public: false`), service-role upload only, read via signed URLs.

| Bucket | Contents | Written by |
|---|---|---|
| `recordings` | 10s audio chunks from an SOS session, at `<sessionId>/<ts>.webm` | `/api/recording` |
| `report-photos` | Downscaled report photos, named by uuid | `/api/report` |

## Conventions worth preserving

- **`id` is a `bigint identity` for grid and history tables, a `uuid` for anything a
  client must name.** Supplying a `bigint identity` value fails — the seed omits `id`.
- **No triggers.** The one write that touches more than one table (report → 3 nearest
  cells) lives in `/api/report` so the whole policy is readable in one file.
- **No score column.** If you find yourself wanting to persist one, you are about to
  introduce a stale-cache bug.
- **Nothing periodic.** Decay, aggregation and "top 10" are all computed on read.
  609 rows and a few hundred reports make that free; the day it stops being free,
  the aggregation in `/api/dashboard` is the thing to move into SQL.
