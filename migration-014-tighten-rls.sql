-- migration-014-tighten-rls.sql
-- SECURITY FIX: stop allowing anonymous (unauthenticated) reads of operational
-- tables. Previously anyone with the Supabase URL + anon key (both public,
-- embedded in the dashboard) could `curl` the REST API and read every column
-- of every property, booking, job and cleaning record — including owner PII,
-- guest names, WiFi passwords and lockbox access codes inside guest_guide.
--
-- After this migration, only authenticated users can read these tables.
-- The public guest guide (/api/guide?id=...) is unaffected because it uses
-- the SERVICE_ROLE_KEY server-side, which bypasses RLS by design.
--
-- Idempotent — safe to re-run.

-- ─── PROPERTIES ─────────────────────────────────────────────────────────────
alter table public.properties enable row level security;
drop policy if exists "properties_read_anon" on public.properties;
drop policy if exists "properties_read_auth" on public.properties;
create policy "properties_read_auth"
  on public.properties for select
  to authenticated
  using (true);

-- ─── BOOKINGS ───────────────────────────────────────────────────────────────
alter table public.bookings enable row level security;
drop policy if exists "bookings_read_anon" on public.bookings;
drop policy if exists "bookings_read_auth" on public.bookings;
create policy "bookings_read_auth"
  on public.bookings for select
  to authenticated
  using (true);

-- ─── CLEANING_COMPLETIONS ───────────────────────────────────────────────────
alter table public.cleaning_completions enable row level security;
drop policy if exists "cleaning_completions_read_anon" on public.cleaning_completions;
drop policy if exists "cleaning_completions_read_auth" on public.cleaning_completions;
create policy "cleaning_completions_read_auth"
  on public.cleaning_completions for select
  to authenticated
  using (true);

-- ─── JOBS ───────────────────────────────────────────────────────────────────
-- The jobs table isn't defined in any migration in this repo (it was created
-- ad-hoc in Supabase), so guard with `if exists`. Defensive: drop any anon
-- policy if one is there, add an auth-only one.
do $$
begin
  if exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'jobs'
  ) then
    execute 'alter table public.jobs enable row level security';
    execute 'drop policy if exists "jobs_read_anon" on public.jobs';
    execute 'drop policy if exists "jobs_read_auth" on public.jobs';
    execute 'create policy "jobs_read_auth" on public.jobs for select to authenticated using (true)';
  end if;
end $$;

-- ─── REALTIME SUBSCRIPTIONS ────────────────────────────────────────────────
-- Supabase Realtime piggy-backs on the same RLS as SELECT. Now that anon
-- can't read, the dashboard's authenticated user can still subscribe — no
-- changes needed here, just noted for awareness.

-- ─── VERIFY ────────────────────────────────────────────────────────────────
-- After running, you can confirm no anon read policies remain with:
--   select schemaname, tablename, policyname, roles, cmd
--   from pg_policies
--   where schemaname = 'public' and cmd = 'SELECT'
--   order by tablename;
-- Every row in `roles` should be `{authenticated}`. None should contain `anon` or `public`.
