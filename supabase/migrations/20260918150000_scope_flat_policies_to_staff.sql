-- Gap 5 of docs/xapi-readiness-2026-09-18.md (ARCHITECTURE §1 #7).
-- Replaces every "any signed-in account has full access" policy on student and
-- course data with the suite's staff pattern: staff read (is_staff), admin
-- writes (can_write; the demo account is read-only). Covers the public tables
-- below and every rcs.* table the Report Card Tool and CourseBoard use,
-- including rcs.generated_comments (IEP notes).
--
-- Deliberately untouched:
--   public.learning_standards / learning_standard_rubrics / core_competency_*:
--     curriculum text, not personal data; anon rubric reads are intentional.
--   rcs.surveys (public_active_surveys) and rcs.survey_responses anonymous
--     insert: the student survey flow.
--   Service-role routes (surveys, board, Course Hub API) bypass RLS anyway.
do $$
declare
  t record;
  tables text[][] := array[
    ['public','courses'], ['public','teaching_groups'],
    ['public','student_marks'], ['public','student_notes'],
    ['rcs','assignment_standards'], ['rcs','assignments'], ['rcs','canonical_data'],
    ['rcs','course_blocks'], ['rcs','course_hub_links'], ['rcs','course_resources'],
    ['rcs','course_subject_areas'], ['rcs','course_unit_sections'], ['rcs','course_units'],
    ['rcs','courses'], ['rcs','enrollments'], ['rcs','generated_comments'],
    ['rcs','learning_standards'], ['rcs','students'], ['rcs','subject_areas']
  ];
  i int;
  s text; n text; p record;
begin
  for i in 1 .. array_length(tables, 1) loop
    s := tables[i][1]; n := tables[i][2];
    -- drop only the flat "true" policies; keep anything already scoped
    for p in select policyname from pg_policies
             where schemaname = s and tablename = n and roles::text = '{authenticated}'
               and cmd = 'ALL' and qual = 'true' loop
      execute format('drop policy %I on %I.%I', p.policyname, s, n);
    end loop;
    execute format('create policy %I on %I.%I for select using (public.is_staff())', n||'_staff_select', s, n);
    execute format('create policy %I on %I.%I for insert with check (public.can_write())', n||'_staff_insert', s, n);
    execute format('create policy %I on %I.%I for update using (public.can_write()) with check (public.can_write())', n||'_staff_update', s, n);
    execute format('create policy %I on %I.%I for delete using (public.can_write())', n||'_staff_delete', s, n);
  end loop;
end $$;
