-- ============================================================================
-- CUM — per-user data isolation
--
-- Problem: Tasks, calendars, meals, user_settings had RLS enabled but the only
-- policy was `auth.uid() IS NOT NULL`, so every logged-in user could read and
-- write EVERY user's rows. This migration:
--   1. adds user_id (uuid -> auth.users) to each table
--   2. backfills existing rows to the primary account (pranav.takrani@gmail.com)
--   3. defaults user_id to auth.uid() so new inserts are auto-owned
--   4. replaces the permissive policy with owner-scoped policies
--
-- Idempotent-ish: guarded with IF NOT EXISTS where possible.
-- ============================================================================

-- Primary owner for existing, pre-isolation rows.
do $$
declare
  primary_uid uuid;
begin
  select id into primary_uid from auth.users where email = 'pranav.takrani@gmail.com' limit 1;
  if primary_uid is null then
    raise exception 'primary user pranav.takrani@gmail.com not found';
  end if;

  -- ---- Tasks ----
  alter table public."Tasks" add column if not exists user_id uuid references auth.users(id) on delete cascade;
  update public."Tasks" set user_id = primary_uid where user_id is null;
  alter table public."Tasks" alter column user_id set default auth.uid();
  alter table public."Tasks" alter column user_id set not null;

  -- ---- calendars ----
  alter table public.calendars add column if not exists user_id uuid references auth.users(id) on delete cascade;
  update public.calendars set user_id = primary_uid where user_id is null;
  alter table public.calendars alter column user_id set default auth.uid();
  alter table public.calendars alter column user_id set not null;

  -- ---- meals ----
  alter table public.meals add column if not exists user_id uuid references auth.users(id) on delete cascade;
  update public.meals set user_id = primary_uid where user_id is null;
  alter table public.meals alter column user_id set default auth.uid();
  alter table public.meals alter column user_id set not null;

  -- ---- user_settings ----
  alter table public.user_settings add column if not exists user_id uuid references auth.users(id) on delete cascade;
  update public.user_settings set user_id = primary_uid where user_id is null;
  alter table public.user_settings alter column user_id set default auth.uid();
  alter table public.user_settings alter column user_id set not null;
end $$;

-- One settings row per user.
create unique index if not exists user_settings_user_uidx on public.user_settings (user_id);

-- ---- Replace the permissive "authenticated only" policy with owner scoping ----
-- Tasks
drop policy if exists "authenticated only" on public."Tasks";
drop policy if exists tasks_owner on public."Tasks";
create policy tasks_owner on public."Tasks"
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- calendars
drop policy if exists "authenticated only" on public.calendars;
drop policy if exists calendars_owner on public.calendars;
create policy calendars_owner on public.calendars
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- meals
drop policy if exists "authenticated only" on public.meals;
drop policy if exists meals_owner on public.meals;
create policy meals_owner on public.meals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- user_settings
drop policy if exists "authenticated only" on public.user_settings;
drop policy if exists user_settings_owner on public.user_settings;
create policy user_settings_owner on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
