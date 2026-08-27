-- ============================================================================
-- CUM — per-user Google OAuth + calendar sharing
--
-- Replaces the single shared Google refresh token (oauth_tokens had one row,
-- seeded manually offline) with a per-user token, so each user connects their
-- own Google account. Also replaces the old "create a shared calendar and
-- manually add events" feature with "send one of your connected Google
-- calendars to another user" (their live events, read-only).
-- ============================================================================

-- ---- oauth_tokens: add user_id, repoint PK -------------------------------
alter table public.oauth_tokens add column if not exists user_id uuid references auth.users(id) on delete cascade;

do $$
declare
  primary_uid uuid;
begin
  select id into primary_uid from auth.users where email = 'pranav.takrani@gmail.com' limit 1;
  if primary_uid is not null then
    update public.oauth_tokens set user_id = primary_uid
    where provider = 'google_calendar' and user_id is null;
  end if;
end $$;

alter table public.oauth_tokens drop constraint if exists oauth_tokens_pkey;
alter table public.oauth_tokens add primary key (provider, user_id);

-- ---- oauth_pending_state: short-lived OAuth state -> user mapping --------
-- service_role only (backend uses this during the redirect round-trip).
create table if not exists public.oauth_pending_state (
  state      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.oauth_pending_state enable row level security;

-- ---- calendar_shares: "send my calendar to a user" ------------------------
create table if not exists public.calendar_shares (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  grantee_id  uuid not null references auth.users(id) on delete cascade,
  calendar_id text not null,
  label       text,
  created_at  timestamptz not null default now(),
  unique (owner_id, grantee_id, calendar_id)
);
alter table public.calendar_shares enable row level security;

drop policy if exists calendar_shares_select on public.calendar_shares;
create policy calendar_shares_select on public.calendar_shares
  for select using (owner_id = auth.uid() or grantee_id = auth.uid());

drop policy if exists calendar_shares_insert on public.calendar_shares;
create policy calendar_shares_insert on public.calendar_shares
  for insert with check (owner_id = auth.uid());

drop policy if exists calendar_shares_delete on public.calendar_shares;
create policy calendar_shares_delete on public.calendar_shares
  for delete using (owner_id = auth.uid());

-- ---- drop the old shared-calendar feature (fully replaced) ---------------
drop trigger if exists on_shared_calendar_created on public.shared_calendars;
drop function if exists public.handle_new_shared_calendar();
drop function if exists public.add_shared_calendar_member(uuid, text);
drop function if exists public.is_shared_calendar_owner(uuid);
drop function if exists public.is_shared_calendar_member(uuid);
drop table if exists public.shared_calendar_events;
drop table if exists public.shared_calendar_members;
drop table if exists public.shared_calendars;
