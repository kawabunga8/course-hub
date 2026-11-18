-- Explicit pronouns for a student, so comment generation (RCS Report Card Tool) and any
-- other consumer can use what the student actually uses instead of guessing from gender.
--
-- Free text on purpose (e.g. 'he/him', 'she/her', 'they/them', 'he/they'); the Students
-- page offers the common ones. NULL means "not recorded" — consumers fall back to
-- deriving from gender, and to they/them when gender is unset too.
alter table public.students
  add column if not exists pronouns text;

comment on column public.students.pronouns is
  'Pronouns the student uses, e.g. he/him, she/her, they/them. NULL = not recorded (consumers fall back to gender).';
