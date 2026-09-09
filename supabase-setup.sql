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
