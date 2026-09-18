# xAPI readiness check — 2026-09-18

A read-only inspection of the live Supabase projects against
[ADR-0001](adr/0001-learning-record-as-xapi-shaped-statements.md). Only counts
and structure were read; no student names. Row counts are exact `count(*)`
(Postgres's own table statistics were stale and showed zero for some live tables).

## Ready

| Area | Finding |
| --- | --- |
| Hosting | `kawabunga8's Project`, `ca-central-1` (Canada), org on **Pro** (daily backups). 23 MB database, 16 MB storage. |
| Student identity | 286 students, one row per person across 2025-26 and 2026-27. 3 have no `student_number`. |
| Enrolments | 451, every one linked to a `course_id`. |
| Standards | 40 current `learning_standards` across ADST, Bible, CLE, FA, Worship Leadership; versioned via `superseded_by`. |
| Rubric levels | Exactly four: `emerging`, `developing`, `proficient`, `extending`. |
| Existing permissions | `students`, `enrollments`, `learning_standards`, `school_quarters` and the **Student Photos** bucket (private) are already staff-gated through `is_staff()` / `can_write()` (2 staff accounts). Better than ARCHITECTURE §1 #7 describes. |
| **Real assessment history** | `rcs.generated_comments`: 191 report-card records for 143 students, 2025-26 Q2–Q4. `proficiency_levels` is keyed by `rcs.learning_standards.id`, and **all 20 keys map to a Course Hub standard** via `public_standard_id`. This is a clean, honest backfill source for `assessed` statements. |

## Gaps to close first

1. ✅ **Resolved 2026-09-18** (4 levels + `plus` flag; IE = insufficient evidence, no level; see ADR-0001). **Two level vocabularies.** Rubrics use 4 levels; report cards also use
   `Emerging+`, `Proficient+`, `Extending+` and `IE`, and never `Developing`.
   A statement's `result_level` needs one agreed list. Decide whether `+`
   is a separate level or a modifier, and how `IE` (insufficient evidence) is
   recorded (probably as *no* statement, or a result with no level).
2. ✅ **Resolved 2026-09-18** (`20260918140000_school_years_and_course_codes`): `course_catalog` with 12 codes; every academic `courses` row has `course_code` (Chapel/Flex/Lunch stay null). **No stable course code.** 32 `public.courses` rows, 21 distinct names, no
   `code` column. `teaching_groups` (21) is per-year, not a catalogue.
   3 courses have no `school_year`.
3. ✅ **Resolved 2026-09-18** (same migration): `school_years` holds 2025-26 (records from 2026-01-19) and 2026-27 (current); year columns in `courses`, `enrollments`, `school_quarters`, `teaching_groups`, `rcs.enrollments`, `rcs.generated_comments` and `rcs.course_hub_links` must now match it. **No `school_years` table.** Years are free text everywhere.
4. **Permissions still open:**
   - ✅ Fixed 2026-09-18 (`20260918120000_close_open_policies`): `class_course_links`, `classes`, old KawaHoot tables. ✅ `rcs.reference_documents` fixed the same day (report-card-tool `dcbac43` + `91b1a46`).
   - `public.class_course_links`: **RLS is off**, so anyone with the public key can read and write it.
   - `rcs.reference_documents`: writable by `anon`.
   - `public.classes`: a leftover `Authenticated full access` policy overrides its staff-only policies.
   - ✅ Fixed 2026-09-18 (`20260918150000_scope_flat_policies_to_staff`): staff read, admin writes, demo read-only; tested as admin, demo and a non-staff signed-in user.
   - `student_marks`, `student_notes`, `courses`, `teaching_groups` and **every `rcs.*` table**, including `generated_comments` (which holds IEP notes): any signed-in account has full access.
   - Old KawaHoot tables in the main project (`games`, `players`, `answers`, `quiz_questions`, `teams`): open to `anon`. Last used 2026-08-05; KawaHoot moved to `KawahootCA` on 2026-08-06.
5. ✅ **Resolved 2026-09-18** (KawaHoot `supabase/migrations/20260918180000_player_student_identity.sql` + server-verified auto-claim). **KawaHoot identity regressed.** The old `players` table had `student_id`
   (7 linked). The live `KawahootCA.players` (22 players, 214 answers) has
   no `student_id`, only nickname / `real_name`. `answers` there are readable
   by anyone, though tied only to nicknames.
6. **Search path gotcha.** The database's `search_path` is `rcs, public`, so an
   unqualified `courses` means `rcs.courses`. All new SQL must write
   `public.learning_statements` explicitly.

## Corrections to ADR-0001

- `student_marks` and `student_notes` are **empty**; there is nothing to migrate
  from them. The backfill source is `rcs.generated_comments` instead.
- The backfill must copy **levels only**. `iep_notes`, `has_iep`,
  `additional_notes` and the generated comment text do not become statements.

## Suggested order

1. Small security fixes (item 4): enable RLS on `class_course_links`, remove
   the `anon` policy on `reference_documents`, drop the leftover `classes`
   policy, then drop or lock the old KawaHoot tables.
2. Decide the level vocabulary (item 1).
3. Course codes and `school_years` (items 2–3).
4. Build `public.learning_statements` + `POST /api/statements`; backfill from
   `generated_comments`.
5. Restore `student_id` on KawaHoot players (item 5) before `answered` statements.

## Follow-ups created by the fixes

- **Course form needs a code field.** New academic courses get `course_code`
  null until Course Hub's course form can set it. Once it can, add
  `check (type <> 'academic' or course_code is not null)`.
- **Yearly rollover must add the year first.** Inserting 2027-28 quarters,
  courses or enrolments now fails until a `school_years` row for 2027-28
  exists. That is the intended loud failure; the rollover steps (ARCHITECTURE §6)
  should start by inserting it.
- ✅ **Functions anyone could call** (found by the security advisor during the
  fixes). Fixed 2026-09-18 (`20260918160000_restrict_security_definer_functions`):
  `rcs.upsert_school_quarters` (anyone could rewrite quarter dates) and
  `sync_class_from_teaching_group` are no longer callable; draft-plan
  resolution needs sign-in; trigger functions and stray `rcs` copies revoked.
  The 7 remaining advisor warnings are the TOC public-page functions, which are
  intended. Still open: enable *Leaked password protection* in Supabase Auth
  settings.
