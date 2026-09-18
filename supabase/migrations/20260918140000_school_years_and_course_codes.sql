-- Gap 4 of docs/xapi-readiness-2026-09-18.md (ARCHITECTURE §1 #8 and #9).
-- Purely additive: new tables, one new column, and foreign keys on existing
-- year columns. Nothing is renamed or removed; no app change is required.

-- 1. school_years: a canonical list, so a mistyped year fails loudly instead of
--    creating a phantom year. Dates come from school_quarters.
create table public.school_years (
  code          text primary key check (code ~ '^\d{4}-\d{2}$'),
  starts_on     date not null,
  ends_on       date not null,
  is_current    boolean not null default false,
  is_archived   boolean not null default false,
  records_from  date,   -- null = no records kept; see ARCHITECTURE §4
  records_note  text,
  check (ends_on > starts_on)
);
create unique index school_years_one_current on public.school_years (is_current) where is_current;

insert into public.school_years (code, starts_on, ends_on, is_current, records_from, records_note)
select school_year, min(start_date), max(end_date), school_year = '2026-27',
       case school_year when '2025-26' then date '2026-01-19' else min(start_date) end,
       case school_year when '2025-26' then 'Course Hub adopted mid-year, from Q3' end
from public.school_quarters group by school_year;

alter table public.school_years enable row level security;
create policy school_years_staff_select on public.school_years for select using (public.is_staff());
create policy school_years_staff_write  on public.school_years for all using (public.can_write()) with check (public.can_write());

-- Every existing year column must now name a real year.
alter table public.courses         add constraint courses_school_year_fk         foreign key (school_year) references public.school_years(code) on update cascade;
alter table public.enrollments     add constraint enrollments_school_year_fk     foreign key (school_year) references public.school_years(code) on update cascade;
alter table public.school_quarters add constraint school_quarters_school_year_fk foreign key (school_year) references public.school_years(code) on update cascade;
alter table public.teaching_groups add constraint teaching_groups_school_year_fk foreign key (school_year) references public.school_years(code) on update cascade;
alter table rcs.enrollments        add constraint rcs_enrollments_school_year_fk foreign key (school_year) references public.school_years(code) on update cascade;
alter table rcs.generated_comments add constraint rcs_generated_comments_school_year_fk foreign key (school_year) references public.school_years(code) on update cascade;
alter table rcs.course_hub_links   add constraint rcs_course_hub_links_school_year_fk foreign key (school_year) references public.school_years(code) on update cascade;

-- 2. course_catalog: the timeless course. A stable code, never the display name,
--    reconnects a course to its own history across renames and gap years.
create table public.course_catalog (
  code          text primary key check (code ~ '^[A-Z][A-Z0-9]*$'),
  name          text not null,
  grade_years   int[] not null default '{}',
  status        text not null default 'active' check (status in ('active','dormant','retired')),
  superseded_by text references public.course_catalog(code),
  created_at    timestamptz not null default now()
);
insert into public.course_catalog (code, name, grade_years) values
  ('BAND9',  'Band 9',                    '{9}'),
  ('BAND10', 'Band 10',                   '{10}'),
  ('BAND11', 'Band 11',                   '{11}'),
  ('BAND12', 'Band 12',                   '{12}'),
  ('BP10',   'Biblical Perspectives 10',  '{10}'),
  ('CLE10',  'Career Life Education 10',  '{10}'),
  ('CS10',   'Computer Studies 10',       '{10}'),
  ('ICT9',   'ICT 9',                     '{9}'),
  ('CP11',   'Computer Programming 11',   '{11}'),
  ('CP12',   'Computer Programming 12',   '{12}'),
  ('WL11',   'Worship Leadership 11',     '{11}'),
  ('WL12',   'Worship Leadership 12',     '{12}');

alter table public.course_catalog enable row level security;
create policy course_catalog_staff_select on public.course_catalog for select using (public.is_staff());
create policy course_catalog_staff_write  on public.course_catalog for all using (public.can_write()) with check (public.can_write());

-- Each yearly course row points at its catalogue course. Chapel, Flex and Lunch
-- are timetable blocks, not courses, and stay null.
alter table public.courses add column course_code text references public.course_catalog(code) on update cascade;
-- The courses triggers re-sync classes and rcs quarters on any update. Adding a
-- code changes nothing they derive from, so pause them for the backfill only.
alter table public.courses disable trigger courses_sync_class;
alter table public.courses disable trigger trg_sync_quarters_from_course;
update public.courses set course_code = case
  when name in ('Concert Band 9', 'Band 9 (Q3/Q4)')                                   then 'BAND9'
  when name = 'Band 10'                                                               then 'BAND10'
  when name = 'Band 11'                                                               then 'BAND11'
  when name = 'Band 12'                                                               then 'BAND12'
  when name = 'Biblical Perspectives 10'                                              then 'BP10'
  when name = 'Career Life Education 10'                                              then 'CLE10'
  when name in ('Computer Studies 10 Q3/Q4', 'CS10 (Q1/Q2)', 'CS10 (Q3/Q4)')          then 'CS10'
  when name in ('ICT 9 Q1', 'ICT 9 Q2', 'ICT 9 (Q1)', 'ICT 9 (Q2)')                   then 'ICT9'
  when name = 'CP 11'                                                                 then 'CP11'
  when name = 'CP 12'                                                                 then 'CP12'
  when name = 'WL 11'                                                                 then 'WL11'
  when name = 'WL 12'                                                                 then 'WL12'
end
where type = 'academic';
alter table public.courses enable trigger courses_sync_class;
alter table public.courses enable trigger trg_sync_quarters_from_course;

-- One-time guard: every existing academic course got a code. Not a permanent
-- CHECK yet: Course Hub's course form has no code field, so a constraint would
-- make "add course" fail. Add the field first, then the constraint.
do $$ begin
  if exists (select 1 from public.courses where type = 'academic' and course_code is null) then
    raise exception 'An academic course has no course_code';
  end if;
end $$;
