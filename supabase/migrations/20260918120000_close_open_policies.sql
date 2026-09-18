-- Close permissions that were open to anyone holding the public (anon) key,
-- or that bypassed the staff-only policies. See docs/xapi-readiness-2026-09-18.md.

-- 1. class_course_links had RLS switched off: anyone could read and write it.
--    Give it the same staff pattern as the rest of the shared tables.
--    toc-dayplans reads/writes it via the service role, which bypasses RLS.
alter table public.class_course_links enable row level security;
create policy class_course_links_staff_select on public.class_course_links for select using (public.is_staff());
create policy class_course_links_staff_insert on public.class_course_links for insert with check (public.can_write());
create policy class_course_links_staff_update on public.class_course_links for update using (public.can_write()) with check (public.can_write());
create policy class_course_links_staff_delete on public.class_course_links for delete using (public.can_write());

-- 2. classes: a leftover "Authenticated full access" policy overrode the
--    staff-only policies (policies are OR'd), letting the demo account write.
drop policy if exists "Authenticated full access" on public.classes;

-- 3. Retired KawaHoot tables in the main project (KawaHoot moved to its own
--    project, KawahootCA, on 2026-08-06; last use here 2026-08-05). They were
--    open to anon and hold real student links. Kept, not dropped; staff-only.
do $$
declare t text; p record;
begin
  foreach t in array array['games','players','answers','quiz_questions','teams'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for select using (public.is_staff())', t||'_retired_staff_select', t);
  end loop;
end $$;
