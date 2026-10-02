-- HerGuardian schema — paste whole file into Supabase SQL editor.
-- No auth MVP: uuid = capability. Service role (server-only) bypasses RLS.

create table safety_cells (
  id bigint generated always as identity primary key,
  lat double precision not null,
  lng double precision not null,
  crime_risk real not null default .3 check (crime_risk between 0 and 1),
  report_risk real not null default 0 check (report_risk between 0 and 1),
  report_bumped_at timestamptz,                      -- decay anchor, applied at read time
  lighting real not null default .5 check (lighting between 0 and 1),  -- OSM street_lamp density
  crowd   real not null default .5 check (crowd   between 0 and 1),    -- OSM POI density
  updated_at timestamptz not null default now()
);
create index safety_cells_loc_idx on safety_cells (lat, lng);

create table incidents (                             -- seeded history; provenance in data
  id bigint generated always as identity primary key,
  category text not null check (category in ('harassment','theft','assault','other')),
  severity smallint not null default 1 check (severity between 1 and 3),
  lat double precision not null,
  lng double precision not null,
  occurred_at timestamptz not null,
  source text not null default 'seed-fake'
);

create table reports (                               -- fully anonymous
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('harassment','unsafe_spot','poor_lighting','stalking','other')),
  lat double precision not null,
  lng double precision not null,
  message text,
  media_path text,                                   -- storage object path, not public URL
  seeded boolean not null default false,             -- demo fakes filterable
  created_at timestamptz not null default now()
);
create index reports_created_idx on reports (created_at desc);

create table guardian_sessions (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active','ended','resolved')),
  triggered_by text not null check (triggered_by in ('tap','voice')),
  lat double precision,                              -- latest pin (reload-safe)
  lng double precision,
  media_paths text[] not null default '{}',
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour'
);

-- RLS: capability model, ceiling = uuid secrecy (upgrade path: auth) ------------
alter table safety_cells enable row level security;
create policy "public read cells" on safety_cells for select using (true);

alter table incidents enable row level security;
create policy "public read incidents" on incidents for select using (true);

alter table reports enable row level security;
create policy "anon insert reports" on reports for insert with check (true);
-- no SELECT policy: raw reports readable only via service role (privacy)

alter table guardian_sessions enable row level security;
create policy "anon insert sessions" on guardian_sessions for insert with check (true);
create policy "uuid read sessions" on guardian_sessions for select using (true);
create policy "uuid update sessions" on guardian_sessions for update using (true);

-- private storage: service-role uploads only, signed URLs to read ---------------
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false), ('report-photos', 'report-photos', false)
on conflict (id) do nothing;

-- Web Push (S.6) — run this after the base schema.
-- A push subscription is an endpoint the browser hands us, not identity: it is
-- tied to a browser install, not a person. guardian_id is a free-form label so a
-- device can hold several guardians' endpoints; it is deliberately not a FK to
-- any identity table, because the MVP has no auth and linking one would be the
-- exact mistake PLAN.md §5 argues against.
create table push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique,                     -- the push service URL
  p256dh text not null,
  auth text not null,
  guardian_id text,                                  -- our own label
  user_id uuid,                                      -- set only if the guardian chose to sign in
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  -- prune these: push services 404/410 a dead endpoint within days
  fail_count smallint not null default 0
);
create index push_subscriptions_endpoint_idx on push_subscriptions (endpoint);

-- No read policy: subscriptions are device endpoints, so the browser never needs
-- to list them. All access is service-role from /api/push.
alter table push_subscriptions enable row level security;
