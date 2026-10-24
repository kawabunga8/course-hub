-- Flex block schedule.
--
-- flex_days: what happens in the flex slot on each school day (A–D Flex,
-- Career, Assembly, Chapel, house events, days off). One row per date, copied
-- from the school's flex schedule sheet ("SC Flex Block Schedule <year>.xlsx",
-- kept by the VP office). heading is the first line of the sheet's cell and
-- details the rest, with whitespace tidied and nothing reinterpreted.
-- flex_letter is derived from heading, so nothing can set it out of step.
--
-- flex_rooms: where this teacher goes for each flex letter in a school year
-- (from the campus FLEX Schedule).
--
-- Course Hub owns these, beside school_years and school_quarters: they are
-- school-calendar facts that other apps read. Only the schema lives in this
-- repo. The rows are loaded from supabase-local/shared/data/, outside git,
-- because the sheet names staff and guest speakers and this repo is public.

create table if not exists public.flex_days (
  day          date primary key,
  school_year  text not null references public.school_years(code) on update cascade,
  heading      text not null,
  details      text,
  flex_letter  text generated always as (
                 case when heading ~* '^[ABCD] flex$' then upper(left(heading, 1)) end
               ) stored,
  source       text,
  updated_at   timestamptz not null default now()
);

create index if not exists flex_days_school_year_idx on public.flex_days(school_year);

create table if not exists public.flex_rooms (
  school_year  text not null references public.school_years(code) on update cascade,
  flex_letter  text not null check (flex_letter in ('A', 'B', 'C', 'D')),
  room         text not null,
  note         text,
  primary key (school_year, flex_letter)
);

-- The suite's staff pattern (20260918150000_scope_flat_policies_to_staff):
-- staff read, can_write() writes. The Course Hub API reads with the service
-- role, which bypasses RLS.
alter table public.flex_days enable row level security;
alter table public.flex_rooms enable row level security;

do $$
declare n text;
begin
  foreach n in array array['flex_days', 'flex_rooms'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = n and policyname = n || '_staff_select') then
      execute format('create policy %I on public.%I for select using (public.is_staff())', n || '_staff_select', n);
      execute format('create policy %I on public.%I for insert with check (public.can_write())', n || '_staff_insert', n);
      execute format('create policy %I on public.%I for update using (public.can_write()) with check (public.can_write())', n || '_staff_update', n);
      execute format('create policy %I on public.%I for delete using (public.can_write())', n || '_staff_delete', n);
    end if;
  end loop;
end $$;
