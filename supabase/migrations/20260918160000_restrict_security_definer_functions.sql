-- Gap 7 of docs/xapi-readiness-2026-09-18.md.
-- SECURITY DEFINER functions run with the owner's rights, so anyone allowed to
-- call one bypasses RLS. Supabase grants EXECUTE to PUBLIC/anon/authenticated
-- by default. Revoke where no caller needs it. service_role and the owner keep
-- access, and triggers keep firing (a trigger does not check EXECUTE).
--
-- Kept callable by anyone, on purpose: the TOC public pages call these without
-- signing in, and each returns only published/timetable data:
--   get_block_times_for_date, get_public_classes, get_public_day_plan_by_id,
--   get_public_day_plan_live, get_public_page_layout, get_public_plans_for_week,
--   get_rotation_for_date.

-- 1. Could change data with no sign-in and no staff check.
--    rcs.upsert_school_quarters rewrote quarter dates for anyone who called it;
--    no app calls it.
revoke execute on function rcs.upsert_school_quarters(jsonb)            from public, anon, authenticated;
--    sync_class_from_teaching_group rewrites classes; only triggers call it.
revoke execute on function public.sync_class_from_teaching_group(uuid)  from public, anon, authenticated;
--    Has its own is_staff() check, but no anon caller exists.
revoke execute on function public.seed_toc_block_plan_from_template(uuid) from public, anon;

-- 2. resolve_day_plan_payload returns ANY plan by id, including unpublished
--    drafts, which bypasses the publish gate (toc-dayplans ADR-0001). Only the
--    staff publish route calls it, as a signed-in user.
revoke execute on function public.resolve_day_plan_payload(uuid) from public, anon;
grant  execute on function public.resolve_day_plan_payload(uuid) to authenticated;

-- 3. Trigger functions: never meant to be called directly.
revoke execute on function public.enrollments_fill_course_class() from public, anon, authenticated;
revoke execute on function public.sync_rcs_enrollment()           from public, anon, authenticated;
revoke execute on function public.trg_course_sync_class()         from public, anon, authenticated;
revoke execute on function public.trg_teaching_group_sync()       from public, anon, authenticated;

-- 4. Stray / unused copies in rcs (toc-dayplans ADR-0004). Not dropped, since
--    rcs belongs to the Report Card Tool; just made uncallable.
revoke execute on function rcs.get_public_plans_for_week(date) from public, anon, authenticated;
revoke execute on function rcs.resolve_day_plan_payload(uuid)  from public, anon, authenticated;
revoke execute on function rcs.get_school_quarters()           from public, anon, authenticated;

-- 5. Pin search_path on the two functions the linter flagged, so an object
--    in another schema cannot be substituted at call time.
alter function public.trg_classes_guard()        set search_path = public;
alter function rcs.sync_quarters_from_course()   set search_path = public, rcs;
