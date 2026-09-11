-- Baseline for public.school_quarters. This table predates the migration
-- history in this repo — it was created directly against the live database
-- and never checked in, so `supabase db pull`/a fresh environment had no
-- record of its shape. `create table if not exists` makes this a no-op
-- against the existing production table; it exists so the schema is fully
-- reconstructable from migrations and so future changes to this table have
-- something to diff against.
--
-- `id` is the table's own auto-increment primary key — NOT a quarter number.
-- 2025-26's rows happened to land on ids 1-4, but 2026-27's landed on
-- 101-104, which silently broke quarter matching against courses.quarters
-- ("1".."4") until resolveCurrentQuarter (src/lib/school-year.ts) was fixed
-- to key off `label` (e.g. "Q1") instead. Keep using `label` for anything
-- that needs the quarter number/identity.
create table if not exists public.school_quarters (
  id serial primary key,
  label text not null default '',
  school_year text not null,
  start_date date,
  end_date date
);

-- Every read of this table filters by school_year (see api/courses and
-- api/quarters), same pattern as courses_school_year_idx on public.courses.
create index if not exists school_quarters_school_year_idx
  on public.school_quarters(school_year);

-- Matches the "Authenticated full access" pattern used on public.courses:
-- this table was previously undocumented and may not have had RLS applied
-- consistently with the rest of the schema. Guarded so this is safe to run
-- whether or not RLS/the policy already exist.
alter table public.school_quarters enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'school_quarters'
      and policyname = 'Authenticated full access'
  ) then
    create policy "Authenticated full access" on public.school_quarters
      for all to authenticated using (true) with check (true);
  end if;
end $$;
