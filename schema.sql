-- ═══════════════════════════════════════════════════════════
--  KONG CRM — Supabase Schema
-- ═══════════════════════════════════════════════════════════

-- 1. ATHLETES
create table if not exists athletes (
  id              uuid default gen_random_uuid() primary key,
  first           text not null default '',
  last            text not null default '',
  belt            text default 'white',
  bg              text default 'Athlete',
  email           text default '',
  phone           text default '',
  street          text default '',
  city            text default '',
  statzip         text default '',
  age             text default '',
  weight          text default '',
  wclass          text default '',
  since           text default '',
  since_iso       text default '',
  photo_url       text default '',
  sessions        integer default 0,
  wins            integer default 0,
  losses          integer default 0,
  status          text default 'active',
  inactive_reason text default '',
  inactive_notes  text default '',
  inactive_since  text default '',
  history         jsonb default '[]'::jsonb,
  notes           jsonb default '[]'::jsonb,
  skills          jsonb default '[65,65,65,65,65,65,65,65]'::jsonb,
  created_at      timestamptz default now()
);

-- 2. ATTENDANCE SESSIONS
create table if not exists attendance_sessions (
  id               uuid default gen_random_uuid() primary key,
  session_date     text,
  session_date_raw text,
  session_type     text,
  athlete_ids      jsonb default '[]'::jsonb,
  created_at       timestamptz default now()
);

-- 3. COMPETITION RESULTS
create table if not exists competition_results (
  id           uuid default gen_random_uuid() primary key,
  event_name   text not null,
  athlete_id   uuid references athletes(id) on delete cascade,
  division     text default 'Open',
  result_date  text,
  place        text,
  matches_won  integer default 0,
  matches_lost integer default 0,
  created_at   timestamptz default now()
);

-- 4. EVENTS
create table if not exists events (
  id          uuid default gen_random_uuid() primary key,
  event_name  text not null,
  event_date  text,
  event_loc   text default 'TBD',
  created_at  timestamptz default now()
);

-- 5. ACTIVITY LOG
create table if not exists activity_log (
  id         uuid default gen_random_uuid() primary key,
  text       text,
  time_str   text,
  created_at timestamptz default now()
);

-- ── ROW LEVEL SECURITY ────────────────────────────────────
alter table athletes            enable row level security;
alter table attendance_sessions enable row level security;
alter table competition_results enable row level security;
alter table events              enable row level security;
alter table activity_log        enable row level security;

-- Authenticated users have full access to all tables
create policy "auth_all" on athletes
  for all using (auth.uid() IS NOT NULL)
  with check (auth.uid() IS NOT NULL);

create policy "auth_all" on attendance_sessions
  for all using (auth.uid() IS NOT NULL)
  with check (auth.uid() IS NOT NULL);

create policy "auth_all" on competition_results
  for all using (auth.uid() IS NOT NULL)
  with check (auth.uid() IS NOT NULL);

create policy "auth_all" on events
  for all using (auth.uid() IS NOT NULL)
  with check (auth.uid() IS NOT NULL);

create policy "auth_all" on activity_log
  for all using (auth.uid() IS NOT NULL)
  with check (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════
