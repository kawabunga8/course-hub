-- School-wide reference documents, such as the Employee Handbook, stored as
-- extracted text so they can be read in Course Hub without a file download.
--
-- Schema-qualified throughout: this database also holds the Report Card Tool's
-- rcs schema, and the SQL Editor's search_path puts rcs first, so an unqualified
-- create can land in the wrong schema where PostgREST will never find it.

create table if not exists public.school_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  school_year text,
  source_filename text,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists school_documents_school_year_idx
  on public.school_documents(school_year);

alter table public.school_documents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'school_documents'
      and policyname = 'Authenticated full access'
  ) then
    create policy "Authenticated full access" on public.school_documents
      for all to authenticated using (true) with check (true);
  end if;
end $$;
