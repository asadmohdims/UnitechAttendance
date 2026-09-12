-- Shop Attendance Tracker — Supabase setup
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run

-- Employees
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Attendance records (one row per in/out session)
create table if not exists records (
  id uuid primary key default gen_random_uuid(),
  emp_id uuid not null references employees(id) on delete cascade,
  date date not null,
  clock_in timestamptz not null,
  clock_out timestamptz,
  in_photo text,
  out_photo text,
  created_at timestamptz not null default now()
);
create index if not exists records_date_idx on records(date);
create index if not exists records_emp_idx on records(emp_id);

-- Row Level Security: only logged-in users can read/write
alter table employees enable row level security;
alter table records enable row level security;

create policy "authenticated full access" on employees
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on records
  for all to authenticated using (true) with check (true);

-- Private storage bucket for clock-in/out photos
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy "authenticated upload photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');
create policy "authenticated read photos" on storage.objects
  for select to authenticated using (bucket_id = 'photos');
create policy "authenticated delete photos" on storage.objects
  for delete to authenticated using (bucket_id = 'photos');
-- Needed for re-uploading to an existing path with upsert:true (e.g. "Retake photo") — Supabase
-- Storage treats overwriting an existing object as an update, not an insert, so without this the
-- first upload to a path succeeds but every subsequent upsert to that same path hits RLS and fails.
create policy "authenticated update photos" on storage.objects
  for update to authenticated using (bucket_id = 'photos');

-- Avatar photo per employee (path in the 'photos' bucket, like records.in_photo/out_photo)
alter table employees add column if not exists avatar text;

-- Salary rates: one row per amendment, never edited in place. To price a given pay period,
-- the app picks the row with the latest effective_from that is <= that period's end date —
-- so a new rate applies retroactively to the whole current period, but never reaches back
-- into an already-elapsed month.
create table if not exists salary_rates (
  id uuid primary key default gen_random_uuid(),
  emp_id uuid not null references employees(id) on delete cascade,
  monthly_salary numeric not null,
  effective_from date not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists salary_rates_emp_idx on salary_rates(emp_id);

alter table salary_rates enable row level security;
create policy "authenticated full access" on salary_rates
  for all to authenticated using (true) with check (true);

-- Lunch-paid override: lets the owner opt, per lunch gap, to pay through it as if it were
-- worked time. Stored on the earlier of the two sessions the gap sits between — a flag, never
-- a change to the punch times themselves, so un-checking it in Daily records fully reverts it.
alter table records add column if not exists lunch_paid boolean not null default false;

-- Per-day pay overrides: lets the owner exclude a specific paid Friday holiday from an
-- employee's pay for a month they took more time off than the standing holiday allowance
-- covers. A day with no row here keeps today's default (a Friday is paid, same as always).
-- `paid` is stored explicitly (rather than a table that only ever means "unpaid") so the same
-- mechanism could later cover the opposite direction too (crediting an inferred day off)
-- without another migration — only the "dock a holiday" direction is wired up in the UI today.
create table if not exists day_pay_overrides (
  id uuid primary key default gen_random_uuid(),
  emp_id uuid not null references employees(id) on delete cascade,
  date date not null,
  paid boolean not null,
  created_at timestamptz not null default now(),
  unique (emp_id, date)
);
create index if not exists day_pay_overrides_emp_idx on day_pay_overrides(emp_id);

alter table day_pay_overrides enable row level security;
create policy "authenticated full access" on day_pay_overrides
  for all to authenticated using (true) with check (true);
