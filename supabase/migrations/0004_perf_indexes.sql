-- ============================================================================
-- Performance: indexes on the per-user columns added in 0002.
-- Without these, every RLS-filtered query (WHERE user_id = auth.uid())
-- full-scans the table. meals is indexed with logged_at desc to match the
-- dashboard's "today's meals, newest first" access pattern.
-- ============================================================================

create index if not exists meals_user_idx     on public.meals (user_id, logged_at desc);
create index if not exists tasks_user_idx     on public."Tasks" (user_id);
create index if not exists calendars_user_idx on public.calendars (user_id);
