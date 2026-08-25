-- Step 3 of the classes decommissioning sequence (ARCHITECTURE.md).
--
-- Deletes the legacy public.enrollments rows keyed by class_id. They are not a
-- migration backlog: every one is already represented by a course_id row for the
-- same student in the same block, so migrating them would double every roster.
--
-- Run section 1 first and read the numbers. Section 2 is written so that it can
-- only ever delete a row that provably has a migrated equivalent - if the data
-- has drifted since the analysis, the guard silently protects the difference
-- instead of trusting a count taken months ago.

-- ── 1. Check ────────────────────────────────────────────────────────────────

-- Overall shape.
select
  count(*) filter (where course_id is null)     as legacy_rows,
  count(*) filter (where course_id is not null) as migrated_rows,
  count(*)                                      as total
from public.enrollments;

-- Legacy rows with NO migrated equivalent. This must return zero rows.
-- Anything here is a genuine enrolment that exists only in the legacy form, and
-- deleting it would lose a student from a roster.
select e.id, e.student_id, c.block_label, c.name as class_name, e.school_year
from public.enrollments e
join public.classes c on c.id = e.class_id
where e.course_id is null
  and not exists (
    select 1
    from public.enrollments m
    join public.courses co on co.id = m.course_id
    where m.student_id = e.student_id
      and upper(coalesce(co.block, '')) = upper(coalesce(c.block_label, ''))
  );

-- ── 2. Delete ───────────────────────────────────────────────────────────────
-- Only run this once the query above returns zero rows.

delete from public.enrollments e
using public.classes c
where c.id = e.class_id
  and e.course_id is null
  and exists (
    select 1
    from public.enrollments m
    join public.courses co on co.id = m.course_id
    where m.student_id = e.student_id
      and upper(coalesce(co.block, '')) = upper(coalesce(c.block_label, ''))
  );

-- ── 3. Confirm ──────────────────────────────────────────────────────────────
-- legacy_rows should now be 0, and migrated_rows unchanged from section 1.

select
  count(*) filter (where course_id is null)     as legacy_rows,
  count(*) filter (where course_id is not null) as migrated_rows
from public.enrollments;
