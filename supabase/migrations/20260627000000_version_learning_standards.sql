-- Moves ownership of public.learning_standards / public.learning_standard_rubrics
-- to course-hub and adds version/supersession support so historical references
-- (e.g. rcs.generated_comments, toc day_plans) stay stable when a standard's
-- wording changes for a new school year.
--
-- These tables already exist in the live DB (created via toc-dayplans' schema.sql),
-- so this migration is additive only.

alter table public.learning_standards add column if not exists school_year text;
alter table public.learning_standards add column if not exists superseded_by uuid references public.learning_standards(id);
alter table public.learning_standards add column if not exists superseded_at timestamptz;

alter table public.learning_standards drop constraint if exists learning_standards_unique;
alter table public.learning_standards add constraint learning_standards_unique unique(subject, standard_key, school_year);

create or replace function public.current_learning_standards(p_school_year text)
returns setof public.learning_standards
language sql
stable
as $$
  select distinct on (subject, standard_key) ls.*
  from public.learning_standards ls
  where (ls.school_year = p_school_year or ls.school_year is null)
    and ls.superseded_by is null
  order by subject, standard_key, (ls.school_year is not null) desc;
$$;
