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
-- NO select/update policy, deliberately. An earlier version had
--   create policy "uuid read sessions" ... for select using (true)
-- which reads like a capability gate but is not one: `using (true)` would let ANY
-- client enumerate every live SOS session and read its pin. It was inert only
-- because the anon role has no SELECT grant — luck, not design, and one
-- `grant select to anon` away from leaking every active pin in the city.
-- Nothing needs it: /api/sos reads with the service role, and the browser's only
-- use of the anon key is the Realtime Broadcast, which does not consult RLS here.

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

-- Session-scoped Web Push migration (also safe on an existing project).
begin;
create table if not exists public.push_subscription_sessions (
  push_subscription_id bigint not null references public.push_subscriptions(id) on delete cascade,
  session_id uuid not null references public.guardian_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (push_subscription_id, session_id)
);
create index if not exists push_subscription_sessions_session_idx
  on public.push_subscription_sessions(session_id);
alter table public.push_subscription_sessions enable row level security;
revoke all on public.push_subscription_sessions from public, anon, authenticated;
grant all on public.push_subscription_sessions to service_role;

create or replace function public.subscribe_push_session(
  p_endpoint text, p_p256dh text, p_auth text, p_session_id uuid
) returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare subscription_id bigint;
begin
  -- Upsert locks the endpoint row; unsubscribe takes the same lock.
  insert into public.push_subscriptions(endpoint, p256dh, auth)
    values (p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth
    returning id into subscription_id;
  insert into public.push_subscription_sessions(push_subscription_id, session_id)
    values (subscription_id, p_session_id) on conflict do nothing;
end;
$$;

create or replace function public.unsubscribe_push_session(p_endpoint text, p_session_id uuid)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare subscription_id bigint;
begin
  select id into subscription_id from public.push_subscriptions
    where endpoint = p_endpoint for update;
  if subscription_id is null then return; end if;
  delete from public.push_subscription_sessions
    where push_subscription_id = subscription_id and session_id = p_session_id;
  delete from public.push_subscriptions where id = subscription_id
    and not exists (select 1 from public.push_subscription_sessions
      where push_subscription_id = subscription_id);
end;
$$;

create or replace function public.persist_sos_initial(
  p_id uuid, p_triggered_by text, p_lat double precision, p_lng double precision
) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare inserted_count integer;
begin
  insert into public.guardian_sessions(id, triggered_by, lat, lng, status)
    values (p_id, p_triggered_by, p_lat, p_lng, 'active') on conflict (id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then return true; end if;
  return false;
end;
$$;

-- A terminal-before-create placeholder has no invented trigger or coordinates.
alter table public.guardian_sessions alter column triggered_by drop not null;
alter table public.guardian_sessions drop constraint if exists guardian_sessions_active_trigger;
alter table public.guardian_sessions add constraint guardian_sessions_active_trigger
  check (status <> 'active' or triggered_by is not null);

create or replace function public.persist_sos_terminal(p_id uuid, p_status text)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if p_status not in ('resolved', 'ended') or p_status is null then
    raise exception 'Invalid terminal status';
  end if;
  insert into public.guardian_sessions(id, status, triggered_by)
    values (p_id, p_status, null)
    on conflict (id) do update set status = excluded.status
      where public.guardian_sessions.status = 'active';
end;
$$;

revoke all on function public.persist_sos_terminal(uuid, text) from public, anon, authenticated;
grant execute on function public.persist_sos_terminal(uuid, text) to service_role;

revoke all on function public.subscribe_push_session(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.unsubscribe_push_session(text, uuid) from public, anon, authenticated;
revoke all on function public.persist_sos_initial(uuid, text, double precision, double precision) from public, anon, authenticated;
grant execute on function public.subscribe_push_session(text, text, text, uuid) to service_role;
grant execute on function public.unsubscribe_push_session(text, uuid) to service_role;
grant execute on function public.persist_sos_initial(uuid, text, double precision, double precision) to service_role;
commit;
