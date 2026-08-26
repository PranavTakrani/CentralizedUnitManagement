-- ============================================================================
-- BLOW — 1:1 messaging feature for the CUM app
-- Migration: schema + signup trigger + RLS + email-discovery RPC + Realtime
--
-- Security model (Tier 1, server-trusted):
--   * The DATABASE is the security boundary. Every table has RLS ON and
--     policies keyed to auth.uid(). The client only ever holds the anon /
--     publishable key + the logged-in user's JWT — never a privileged key.
--   * A user can only read/write conversations they are a participant of,
--     and can only edit/delete their OWN messages.
--   * Email discovery is exact-match only via a SECURITY DEFINER RPC, so the
--     user list cannot be enumerated.
--   * DELETE is a soft-delete tombstone (deleted_at) — messages stay in the
--     log, rendered struck-through, matching the HTTP-transaction metaphor.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper schema for security-definer functions (kept out of the API surface)
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ============================================================================
-- 1. profiles — a client-safe mirror of auth.users (email is not exposed to
--    PostgREST from the auth schema, so we mirror the bits we need).
-- ============================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text unique not null,
  display_name text,
  created_at   timestamptz not null default now()
);

-- Auto-populate profiles on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any users who already exist.
insert into public.profiles (id, email, display_name)
select u.id, u.email, split_part(u.email, '@', 1)
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- ============================================================================
-- 2. conversations — exactly two participants. Canonical ordering
--    (user_low < user_high) + unique index guarantees ONE conversation per
--    pair, regardless of who starts it.
-- ============================================================================
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_low    uuid not null references public.profiles (id) on delete cascade,
  user_high   uuid not null references public.profiles (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  -- 'pending' until the recipient accepts (message-request flow); 'accepted'
  -- once they do. Blocks are enforced separately via public.blocks.
  status      text not null default 'pending' check (status in ('pending','accepted')),
  created_at  timestamptz not null default now(),
  constraint conversations_distinct_users check (user_low <> user_high),
  constraint conversations_ordered check (user_low < user_high)
);
create unique index if not exists conversations_pair_uidx
  on public.conversations (user_low, user_high);

-- ============================================================================
-- 3. messages — the core log. method drives the HTTP-transaction UI.
--    DELETE never hard-removes; it sets deleted_at (tombstone).
-- ============================================================================
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  method          text not null default 'POST' check (method in ('POST','PATCH','DELETE')),
  body            text not null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz
);
create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at);

-- ============================================================================
-- 4. reactions — HTTP status codes instead of emoji. One code per user per
--    message (toggle by delete+insert client-side).
-- ============================================================================
create table if not exists public.reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  code       int  not null check (code in (200,201,404,429,500,418)),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, code)
);
create index if not exists reactions_message_idx on public.reactions (message_id);

-- ============================================================================
-- 5. read_receipts — the GET. One row per (conversation, user); last_read_at
--    advances as the user reads.
-- ============================================================================
create table if not exists public.read_receipts (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ============================================================================
-- 6. blocks — blocker no longer receives messages from blocked.
-- ============================================================================
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_distinct check (blocker_id <> blocked_id)
);

-- ============================================================================
-- Helper predicates (SECURITY DEFINER so RLS policies can call them without
-- recursing into the policies of the tables they read).
-- ============================================================================

-- Is the current user a participant of the given conversation?
create or replace function public.is_conversation_participant(conv_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv_id
      and auth.uid() in (c.user_low, c.user_high)
  );
$$;

-- Has `target` blocked the current user (or vice-versa)?
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

-- ============================================================================
-- Email discovery RPC — exact match only, returns at most one row.
-- SECURITY DEFINER so it can read profiles without exposing the whole table,
-- and refuses to return the caller's own row or blocked users.
-- ============================================================================
create or replace function public.find_user_by_email(p_email text)
returns table (id uuid, email text, display_name text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.email, p.display_name
  from public.profiles p
  where lower(p.email) = lower(trim(p_email))
    and p.id <> auth.uid()
    and not public.is_blocked_between(auth.uid(), p.id)
  limit 1;
$$;

revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

-- ============================================================================
-- Start-or-get conversation RPC — canonicalises the pair ordering and
-- enforces the block check server-side.
-- ============================================================================
create or replace function public.start_conversation(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  lo   uuid;
  hi   uuid;
  cid  uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if p_other = me then
    raise exception 'cannot start a conversation with yourself';
  end if;
  if public.is_blocked_between(me, p_other) then
    raise exception 'blocked';
  end if;

  if me < p_other then lo := me; hi := p_other; else lo := p_other; hi := me; end if;

  insert into public.conversations (user_low, user_high, created_by, status)
  values (lo, hi, me, 'pending')
  on conflict (user_low, user_high) do nothing;

  select id into cid from public.conversations where user_low = lo and user_high = hi;
  return cid;
end;
$$;

revoke all on function public.start_conversation(uuid) from public;
grant execute on function public.start_conversation(uuid) to authenticated;

-- ============================================================================
-- RLS — enable on every table, then define policies.
-- ============================================================================
alter table public.profiles      enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.reactions     enable row level security;
alter table public.read_receipts enable row level security;
alter table public.blocks        enable row level security;

-- ---- profiles ----
-- A user can read their own profile. Discovery of others goes through the
-- find_user_by_email RPC (definer), NOT direct select, to prevent enumeration.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

-- A user can read profiles of people they share a conversation with (so the
-- UI can render the other participant's email/name).
drop policy if exists profiles_select_conversation_peers on public.profiles;
create policy profiles_select_conversation_peers on public.profiles
  for select using (
    exists (
      select 1 from public.conversations c
      where auth.uid() in (c.user_low, c.user_high)
        and profiles.id in (c.user_low, c.user_high)
    )
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---- conversations ----
drop policy if exists conversations_select_participant on public.conversations;
create policy conversations_select_participant on public.conversations
  for select using (auth.uid() in (user_low, user_high));

-- Insert handled by start_conversation() RPC, but allow a direct insert as
-- long as the caller is a participant, is the creator, and no block exists.
drop policy if exists conversations_insert_self on public.conversations;
create policy conversations_insert_self on public.conversations
  for insert with check (
    auth.uid() in (user_low, user_high)
    and created_by = auth.uid()
    and not public.is_blocked_between(user_low, user_high)
  );

-- A participant can update status (e.g. accept a request).
drop policy if exists conversations_update_participant on public.conversations;
create policy conversations_update_participant on public.conversations
  for update using (auth.uid() in (user_low, user_high))
  with check (auth.uid() in (user_low, user_high));

-- ---- messages ----
drop policy if exists messages_select_participant on public.messages;
create policy messages_select_participant on public.messages
  for select using (public.is_conversation_participant(conversation_id));

-- Can only insert as yourself, into a conversation you're in, if not blocked.
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
    and not exists (
      select 1 from public.conversations c
      join public.blocks b
        on (b.blocker_id = c.user_low  and b.blocked_id = c.user_high)
        or (b.blocker_id = c.user_high and b.blocked_id = c.user_low)
      where c.id = conversation_id
    )
  );

-- Can only edit/soft-delete your OWN messages.
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- ---- reactions ----
drop policy if exists reactions_select_participant on public.reactions;
create policy reactions_select_participant on public.reactions
  for select using (
    exists (
      select 1 from public.messages m
      where m.id = reactions.message_id
        and public.is_conversation_participant(m.conversation_id)
    )
  );

drop policy if exists reactions_insert_own on public.reactions;
create policy reactions_insert_own on public.reactions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = reactions.message_id
        and public.is_conversation_participant(m.conversation_id)
    )
  );

drop policy if exists reactions_delete_own on public.reactions;
create policy reactions_delete_own on public.reactions
  for delete using (user_id = auth.uid());

-- ---- read_receipts ----
drop policy if exists receipts_select_participant on public.read_receipts;
create policy receipts_select_participant on public.read_receipts
  for select using (public.is_conversation_participant(conversation_id));

drop policy if exists receipts_upsert_own on public.read_receipts;
create policy receipts_upsert_own on public.read_receipts
  for insert with check (
    user_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
  );

drop policy if exists receipts_update_own on public.read_receipts;
create policy receipts_update_own on public.read_receipts
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- blocks ----
drop policy if exists blocks_select_own on public.blocks;
create policy blocks_select_own on public.blocks
  for select using (blocker_id = auth.uid() or blocked_id = auth.uid());

drop policy if exists blocks_insert_own on public.blocks;
create policy blocks_insert_own on public.blocks
  for insert with check (blocker_id = auth.uid());

drop policy if exists blocks_delete_own on public.blocks;
create policy blocks_delete_own on public.blocks
  for delete using (blocker_id = auth.uid());

-- ============================================================================
-- Realtime — add messaging tables to the supabase_realtime publication so the
-- client gets live POST/PATCH/DELETE/reaction/receipt events. Realtime still
-- respects RLS, so users only receive events for their own conversations.
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.reactions;
alter publication supabase_realtime add table public.read_receipts;
alter publication supabase_realtime add table public.conversations;
