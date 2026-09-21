-- school_documents (20260915120000_add_school_documents.sql) was written before
-- the 2026-09-18 staff-scoping pass (20260918150000_scope_flat_policies_to_staff.sql)
-- and didn't inherit it, so it still carries the flat "any signed-in account has
-- full access" policy that pass eliminated everywhere else -- meaning the demo
-- account (should be read-only) and any non-staff signed-in account (should see
-- nothing) currently have full read/write/delete on the Employee Handbook table.
-- Applies the same suite pattern here: is_staff() to read, can_write() to change.

drop policy if exists "Authenticated full access" on public.school_documents;

create policy school_documents_staff_select on public.school_documents
  for select using (public.is_staff());

create policy school_documents_staff_insert on public.school_documents
  for insert with check (public.can_write());

create policy school_documents_staff_update on public.school_documents
  for update using (public.can_write()) with check (public.can_write());

create policy school_documents_staff_delete on public.school_documents
  for delete using (public.can_write());
