-- ═══════════════════════════════════════════════════════════
--  KONG CRM — Athlete Portal Migration (Part 2)
-- ═══════════════════════════════════════════════════════════

-- 0.1 ATHLETE ACCOUNTS TABLE (links auth.users to athletes)
create table if not exists athlete_accounts (
  id           uuid default gen_random_uuid() primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade unique,
  athlete_id   uuid not null references athletes(id) on delete cascade unique,
  created_at   timestamptz default now()
);

alter table athlete_accounts enable row level security;

drop policy if exists "self_lookup" on athlete_accounts;
create policy "self_lookup" on athlete_accounts
  for select using (auth_user_id = auth.uid());

-- 0.3 RLS REWRITE FOR ATHLETES TABLE
drop policy if exists "auth_all" on athletes;
drop policy if exists "coach_full_access" on athletes;
drop policy if exists "athlete_read_self" on athletes;

create policy "coach_full_access" on athletes
  for all using (
    auth.uid() is not null
    and not exists (select 1 from athlete_accounts where auth_user_id = auth.uid())
  )
  with check (
    auth.uid() is not null
    and not exists (select 1 from athlete_accounts where auth_user_id = auth.uid())
  );

create policy "athlete_read_self" on athletes
  for select using (
    id = (select athlete_id from athlete_accounts where auth_user_id = auth.uid())
  );

-- RLS REWRITE FOR COMPETITION RESULTS
drop policy if exists "auth_all" on competition_results;
drop policy if exists "coach_full_access" on competition_results;
drop policy if exists "athlete_read_self_comp" on competition_results;

create policy "coach_full_access" on competition_results
  for all using (
    auth.uid() is not null
    and not exists (select 1 from athlete_accounts where auth_user_id = auth.uid())
  )
  with check (
    auth.uid() is not null
    and not exists (select 1 from athlete_accounts where auth_user_id = auth.uid())
  );

create policy "athlete_read_self_comp" on competition_results
  for select using (
    athlete_id = (select athlete_id from athlete_accounts where auth_user_id = auth.uid())
  );

-- RLS FOR ATTENDANCE, EVENTS, AND ACTIVITY_LOG (COACH ONLY)
drop policy if exists "auth_all" on attendance_sessions;
drop policy if exists "coach_full_access" on attendance_sessions;
create policy "coach_full_access" on attendance_sessions
  for all using (
    auth.uid() is not null
    and not exists (select 1 from athlete_accounts where auth_user_id = auth.uid())
  )
  with check (
    auth.uid() is not null
    and not exists (select 1 from athlete_accounts where auth_user_id = auth.uid())
  );

drop policy if exists "auth_all" on events;
drop policy if exists "coach_full_access" on events;
create policy "coach_full_access" on events
  for all using (
    auth.uid() is not null
    and not exists (select 1 from athlete_accounts where auth_user_id = auth.uid())
  )
  with check (
    auth.uid() is not null
    and not exists (select 1 from athlete_accounts where auth_user_id = auth.uid())
  );

drop policy if exists "auth_all" on activity_log;
drop policy if exists "coach_full_access" on activity_log;
create policy "coach_full_access" on activity_log
  for all using (
    auth.uid() is not null
    and not exists (select 1 from athlete_accounts where auth_user_id = auth.uid())
  )
  with check (
    auth.uid() is not null
    and not exists (select 1 from athlete_accounts where auth_user_id = auth.uid())
  );

-- 0.4 COLUMN-RESTRICTED VIEW (Hides notes & sensitive fields from athlete queries)
create or replace view athlete_portal_view as
select
  id, first, last, belt, bg, since, since_iso, photo_url,
  sessions, wins, losses, status, history, skills, created_at
from athletes;

alter view athlete_portal_view set (security_invoker = on);

-- 0.5 ATTENDANCE RPC FUNCTION (Security Definer)
create or replace function get_my_attendance()
returns table (session_date text, session_date_raw text, session_type text)
language sql
security definer
set search_path = public
as $$
  select session_date, session_date_raw, session_type
  from attendance_sessions
  where athlete_ids @> to_jsonb(
    array[(select athlete_id::text from athlete_accounts where auth_user_id = auth.uid())]
  );
$$;

grant execute on function get_my_attendance() to authenticated;
