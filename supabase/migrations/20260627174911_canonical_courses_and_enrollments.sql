-- Establishes public.courses as the single canonical course/class catalog,
-- replacing the parallel public.classes (course-hub/toc-dayplans) and
-- rcs.courses (rcs-report-card-tool) catalogs. Versioned via supersession,
-- same pattern as public.learning_standards: editing a course that's already
-- been referenced creates a new row rather than mutating history.
--
-- This migration is additive only — it does not touch public.classes,
-- rcs.courses, public.enrollments, or rcs.enrollments. Those get migrated
-- and retired in a follow-up migration once this table exists.

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  block text,
  grade_years int[] not null default '{}',
  school_year text,
  type text not null default 'academic' check (type in ('academic', 'chapel', 'flex', 'lunch', 'cle')),
  room text,
  sort_order int,
  quarters text[],
  superseded_by uuid references public.courses(id),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists courses_block_idx on public.courses(block);
create index if not exists courses_school_year_idx on public.courses(school_year);

-- Resolves which version of each (block, name) course applies for a given
-- school year: prefers an exact school_year match, falls back to the
-- evergreen (school_year is null) row, excludes anything superseded.
create or replace function public.current_courses(p_school_year text)
returns setof public.courses
language sql
stable
set search_path = public
as $$
  select distinct on (block, name) c.*
  from public.courses c
  where (c.school_year = p_school_year or c.school_year is null)
    and c.superseded_by is null
  order by block, name, (c.school_year is not null) desc;
$$;

alter table public.courses enable row level security;
create policy "Authenticated full access" on public.courses for all to authenticated using (true) with check (true);
