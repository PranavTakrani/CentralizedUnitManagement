-- ============================================================================
-- CUM — Shared Calendars (backend-sourced, NOT Google)
--
-- A shared calendar is created by a user, has its own color, and can have
-- multiple members. Its events are stored in our own DB (manually managed via
-- the backend), independent of the Google Calendar integration.
--
-- Access model (RLS): you can see/act on a shared calendar only if you are a
-- member of it. The owner (role='owner') can manage membership and delete it.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---- shared_calendars ------------------------------------------------------
create table if not exists public.shared_calendars (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#cc0000'  -- per-calendar color (new field)
             check (color ~ '^#[0-9a-fA-F]{6}$'),
  owner_id   uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---- shared_calendar_members ----------------------------------------------
create table if not exists public.shared_calendar_members (
  calendar_id uuid not null references public.shared_calendars (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'member' check (role in ('owner','member')),
  created_at  timestamptz not null default now(),
  primary key (calendar_id, user_id)
);

-- ---- shared_calendar_events -----------------------------------------------
create table if not exists public.shared_calendar_events (
  id          uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.shared_calendars (id) on delete cascade,
  title       text not null,
  location    text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_by  uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint shared_events_time_order check (ends_at >= starts_at)
);
create index if not exists shared_events_cal_idx
  on public.shared_calendar_events (calendar_id, starts_at);

-- ---- membership helper (SECURITY DEFINER to avoid RLS recursion) ----------
create or replace function public.is_shared_calendar_member(cal uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.shared_calendar_members m
    where m.calendar_id = cal and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_shared_calendar_owner(cal uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.shared_calendar_members m
    where m.calendar_id = cal and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- On creating a shared calendar, auto-add the owner as an owner-member.
create or replace function public.handle_new_shared_calendar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.shared_calendar_members (calendar_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_shared_calendar_created on public.shared_calendars;
create trigger on_shared_calendar_created
  after insert on public.shared_calendars
  for each row execute function public.handle_new_shared_calendar();

-- ---- RLS -------------------------------------------------------------------
alter table public.shared_calendars        enable row level security;
alter table public.shared_calendar_members enable row level security;
alter table public.shared_calendar_events  enable row level security;

-- shared_calendars: members can read; anyone authenticated can create (they
-- become owner via trigger); owner can update/delete.
drop policy if exists shared_cal_select on public.shared_calendars;
create policy shared_cal_select on public.shared_calendars
  for select using (public.is_shared_calendar_member(id));

drop policy if exists shared_cal_insert on public.shared_calendars;
create policy shared_cal_insert on public.shared_calendars
  for insert with check (owner_id = auth.uid());

drop policy if exists shared_cal_update on public.shared_calendars;
create policy shared_cal_update on public.shared_calendars
  for update using (public.is_shared_calendar_owner(id))
  with check (public.is_shared_calendar_owner(id));

drop policy if exists shared_cal_delete on public.shared_calendars;
create policy shared_cal_delete on public.shared_calendars
  for delete using (public.is_shared_calendar_owner(id));

-- members: a member can see the membership of calendars they belong to.
-- Insert: owner can add members; also allow a row where user adds THEMSELVES
-- only if invited is out of scope — keep it owner-managed. The trigger inserts
-- the initial owner row as SECURITY DEFINER so it bypasses these policies.
drop policy if exists shared_members_select on public.shared_calendar_members;
create policy shared_members_select on public.shared_calendar_members
  for select using (public.is_shared_calendar_member(calendar_id));

drop policy if exists shared_members_insert on public.shared_calendar_members;
create policy shared_members_insert on public.shared_calendar_members
  for insert with check (public.is_shared_calendar_owner(calendar_id));

drop policy if exists shared_members_delete on public.shared_calendar_members;
create policy shared_members_delete on public.shared_calendar_members
  -- owner can remove anyone; a member can remove themselves (leave).
  for delete using (
    public.is_shared_calendar_owner(calendar_id) or user_id = auth.uid()
  );

-- events: any member can read; any member can create/edit/delete events.
drop policy if exists shared_events_select on public.shared_calendar_events;
create policy shared_events_select on public.shared_calendar_events
  for select using (public.is_shared_calendar_member(calendar_id));

drop policy if exists shared_events_insert on public.shared_calendar_events;
create policy shared_events_insert on public.shared_calendar_events
  for insert with check (
    public.is_shared_calendar_member(calendar_id) and created_by = auth.uid()
  );

drop policy if exists shared_events_update on public.shared_calendar_events;
create policy shared_events_update on public.shared_calendar_events
  for update using (public.is_shared_calendar_member(calendar_id))
  with check (public.is_shared_calendar_member(calendar_id));

drop policy if exists shared_events_delete on public.shared_calendar_events;
create policy shared_events_delete on public.shared_calendar_events
  for delete using (public.is_shared_calendar_member(calendar_id));

-- ---- Add-member-by-email RPC (owner only) ----------------------------------
create or replace function public.add_shared_calendar_member(p_calendar uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if not public.is_shared_calendar_owner(p_calendar) then
    raise exception 'only the owner can add members';
  end if;
  select id into target from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if target is null then
    raise exception 'no user with that email';
  end if;
  insert into public.shared_calendar_members (calendar_id, user_id, role)
  values (p_calendar, target, 'member')
  on conflict do nothing;
end;
$$;

revoke all on function public.add_shared_calendar_member(uuid, text) from public;
grant execute on function public.add_shared_calendar_member(uuid, text) to authenticated;
