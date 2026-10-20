# Course Hub — Multi-Year Data Architecture

Goal: one system that accumulates a teaching career's worth of records — many
school years, new timetables and new students each year — without rewriting
history or duplicating people.

This document describes the **target** model and the gap between it and today.

> **Status, 2026-10-20** — checked against the code and the 2026-09-23 schema
> snapshot (`supabase-local/shared/schema-dump.sql`), not the live database.
> Much of §2–§4 now exists: `public.school_years` (with `records_from` /
> `records_note`), `public.course_catalog` (stable `code`, `status` active /
> dormant / retired) linked by `courses.course_code`, `public.teaching_groups`,
> `school_quarters.school_year`, and `enrollments.grade_year`.
> `public.courses` plays the role of `COURSE_OFFERINGS`. §1 describes the
> database before that work. §5 is the current, measured picture of who
> writes what.

---

## 1. What breaks today

Each of these is observed in the live database, not hypothetical.

| # | Problem | Evidence | Consequence in year 2+ |
|---|---|---|---|
| 1 | Year-specific facts stored on the course row | `rcs.courses.school_years` is an array with a single `block` column | A course in two years cannot hold two blocks. Patched with `course_blocks`; the same patch will be needed for room, teacher, section… |
| 2 | Quarters have no school year | `public.school_quarters` = 4 rows, ids 1–4, dates hard-coded to 2025-26 | Next year overwrites this year's dates. Quarter history is lost permanently |
| 3 | ~~Student identity is year-scoped~~ **Resolved** | `enrollments.grade_year` added; 2026-27 imported by matching returning students to their existing row | 76 students now hold enrollments in both years under one identity. `students.school_year` is vestigial and can be dropped |
| 4 | ~~Two competing course tables~~ **Resolved** | Course Hub (`public.courses`) is now the source of truth for all course data; `rcs.course_hub_links` maps it to enrollments | — |
| 5 | Two competing student tables | `public.students` (145) and `rcs.students` (5) | Querying the wrong one silently returns almost nothing. `rcs.students` is test data — numbers 10001–10004 plus 999999, created Mar 2026; 3 of 5 duplicate a real `public.students` person under a different UUID |
| 6 | Missing referential integrity | No FK on `rcs.enrollments.student_id` | The 1 orphaned enrollment was a test-data row (removed); nothing prevents more without the FK |
| 7 | Flat authorisation | Every `rcs.*` policy is `ALL` to `authenticated` using `true` | Any signed-in account reads every student in every year. No per-teacher scoping, no read-only past |
| 8 | Free-text years | `'2025-26'` as a string in courses, enrollments, students, course_blocks | A typo creates a silent phantom year. No canonical list to drive the UI |
| 9 | No stable course identifier | `slug` NULL on all 25 `rcs.courses`; `superseded_by` NULL on all 33 `public.courses` | A course is identifiable only by name — and names drift ("Computer Studies 10" → "Computer Studies 10 Q1/Q2" → "CS10 (Q1/Q2)"). After a gap year, nothing reconnects the course to its own history |
| 10 | "Not taught this year" is unrepresentable | 4 courses carry an empty `school_years` array | A course you are simply not teaching this year is indistinguishable from junk data |

---

## 2. Target model

> **Source of truth: Course Hub.** All course data is read from and stored in
> `public.courses`. It already holds one row per course per school year with
> that year's block, room, quarters and sort order — i.e. it is already the
> `COURSE_OFFERINGS` table below, and `rcs.course_blocks` is superseded by it.
> What it still lacks is a catalogue table giving a course a stable identity
> *across* years; see §3.

The organising idea: **separate the timeless thing from its yearly instance.**

A *course* ("Band 10") is timeless. A *course offering* ("Band 10, 2026-27,
block D, room 130") is the yearly instance. Everything year-specific — block,
room, quarters, enrollments, assignments — hangs off the offering.

Likewise a *student* is a person who persists; an *enrollment* is that person's
yearly participation.

```mermaid
erDiagram
    SCHOOL_YEARS ||--o{ COURSE_OFFERINGS : "scopes"
    SCHOOL_YEARS ||--o{ TERMS : "divides into"
    COURSES ||--o{ COURSE_OFFERINGS : "instantiated as"
    COURSE_OFFERINGS ||--o{ ENROLLMENTS : "has"
    COURSE_OFFERINGS ||--o{ ASSIGNMENTS : "has"
    STUDENTS ||--o{ ENROLLMENTS : "participates via"
    STAFF ||--o{ COURSE_OFFERINGS : "teaches"

    SCHOOL_YEARS {
        text   code PK "2026-27"
        date   starts_on
        date   ends_on
        bool   is_current
        bool   is_archived "past years become read-only"
    }
    COURSES {
        uuid   id PK
        text   code UK "stable: BAND10 — never changes"
        text   name "display name; may drift"
        int[]  grade_years
        text   status "active | dormant | retired"
        uuid   superseded_by FK "lineage when split or merged"
    }
    COURSE_OFFERINGS {
        uuid   id PK
        uuid   course_id FK
        text   school_year FK
        text   block "varies by year"
        text   room
        text[] quarters
        uuid   teacher_id FK
    }
    STUDENTS {
        uuid   id PK "stable for life; no school_year"
        text   first_name
        text   last_name
        text   student_number "external key"
    }
    ENROLLMENTS {
        uuid   id PK
        uuid   offering_id FK
        uuid   student_id FK
        int    grade_year "the student's grade THAT year"
    }
```

### Why each change earns its place

**`school_years` as a table, not a string.** Gives a canonical list to drive the
year selector, a home for term dates, and — critically — an `is_archived` flag
that RLS can enforce. Every year reference becomes a foreign key, so a typo
fails loudly instead of creating a phantom year.

**`course_offerings` replaces `school_years[]` and `course_blocks`.** Any
attribute that varies by year now has an obvious home. This is the change that
stops the recurring "add another side table" cycle — `course_blocks` was
already the first instance of it.

**`students` loses `school_year`; `enrollments` gains `grade_year`.** A student
is one row forever. Their grade level is a property of a given year's
enrollment, not of the person. This is what makes "show me this student across
four years" possible — and it is much harder to retrofit later, once duplicate
rows exist.

> **Done.** `enrollments.grade_year` exists and is populated for both years. The
> 2026-27 import (266 enrollments, 218 students) matched 76 returning students
> to their existing rows rather than creating duplicates. Every one of those 76
> advanced exactly one grade — 9→10 (31), 10→11 (23), 11→12 (22) — which is also
> the check that confirms the name matching did not cross two people.
> `students.school_year` is now vestigial.

**Assignments attach to `offering_id`.** Today they attach to `course_id`, so an
assignment cannot be attributed to a year when the course spans two.

---

## 3. Course continuity across gap years

A course may run, pause for one or more years, then return. This is a normal
part of a teaching assignment, not an exception, and the model must treat it
as such.

**A gap is the absence of an offering, nothing more.** The course row lives in
the catalogue permanently and is never deleted or emptied:

```
courses:            BAND10  "Band 10"        status = active
course_offerings:   BAND10 × 2025-26  block B
                    (no row for 2026-27  ← the gap)
                    BAND10 × 2027-28  block C
```

Because history hangs off offerings rather than the course, the 2025-26
enrollments, assignments and marks stay intact and attributable throughout the
gap. Resuming in 2027-28 is a single insert.

Three properties make this safe:

**1. A stable `code`, never the name.** `BAND10` is the identity; the display
name may change freely. This is what reconnects a returning course to its own
history — and the live data shows why it matters, with one course already
carrying three different names across two years. Matching on name would silently
create a *new* course and orphan everything before the gap.

**2. `status` distinguishes dormant from retired.** Not teaching a course this
year is `dormant` — it stays in the catalogue, out of the year's UI, ready to
resume. `retired` means genuinely gone. Today both look identical (an empty
`school_years` array), which is why four real courses currently sit in limbo.

**3. Clone forward from the most recent offering, not last year's.** When
resuming, prior materials should come from whenever the course last ran:

```sql
-- the offering to copy assignments from when reviving a course
select * from course_offerings
where course_id = $1 and school_year < $2
order by school_year desc
limit 1;
```

A "copy from previous year" implementation would silently find nothing after a
gap and hand back an empty course.

`superseded_by` covers the related but distinct case where a course does not
pause but *changes shape* — "Worship Leadership 11/12" becoming "WL 11" and
"WL 12". The lineage pointer keeps the old offerings reachable without
pretending the new courses are the same one.

### What this makes easy

- *"Every year I have taught this course"* — offerings by `course_id`.
- *"What did I do last time I taught this?"* — most recent prior offering.
- *"Which courses could I revive?"* — `status = 'dormant'`.
- Year selector lists only years with offerings, so a gap year never shows an
  empty course that was not actually running.

---

## 4. Data coverage: absence of records vs absence of students

An empty roster has two very different meanings:

- **No students enrolled** — a real, factual zero.
- **No records kept** — the system was not in use for that period, so the
  absence says nothing about what happened.

Today these are indistinguishable, and the archive silently asserts the first
when the second is true. The live example: the app was implemented partway
through 2025-26, from Q3. `ICT 9 Q1` and `ICT 9 Q2` ran in Q1 and Q2 with real
students, but no roster was ever captured; both now show zero. `Concert Band 9`
(Q3/Q4) has its genuine roster of 36 because it falls after adoption.

The zero on those two ICT sections is therefore **correct as a record** and
**wrong as a fact** — precisely the distinction this section exists to preserve.

A worse variant was already present and has been removed: a bulk import had
assigned all 36 grade-9 students to every block H course, so both ICT sections
falsely reported full rosters. The importer split by grade year, which works
wherever grades differ — blocks A, B and F show zero overlap between their
courses — but block H's three courses are all grade 9, so it could not
distinguish them and assigned everyone to all three. Fabricated records are
more damaging than absent ones: they survive scrutiny.

Over a career this compounds: each gap — a term before adoption, a leave, a
migration — becomes indistinguishable from a genuine zero, and the ability to
tell them apart lives only in memory.

**Record the coverage window as data.** The `school_years` table gains the
period from which records are known complete:

```sql
alter table school_years
  add column records_from date,          -- null = no records kept this year
  add column records_note text;          -- "adopted mid-year, from Q3"
```

For 2025-26 that is the start of Q3, **2026-01-19** — confirmed: the app was
implemented at Q3. Any course whose teaching period falls entirely before
`records_from` is *outside coverage*, and the UI must say so rather than
showing a zero:

> **No records for this course.** CourseBoard was not in use during Q1–Q2 of
> 2025-26. This course ran in Q1; its roster predates the system.

Because Course Hub already stores `quarters` per course and `school_quarters`
holds the dates, this is derivable — no per-course flagging needed.

### Why this belongs in the schema

The distinction cannot be reconstructed later. A future reader — including you
in 2032 — sees only an empty list, and nothing in the data indicates whether to
trust it. Recording coverage once, at the point the gap is known, is the only
moment the information is cheaply available.

It also protects any statistic computed across years. Enrolment totals, "students
taught", and per-course histories are all wrong if uncovered periods are counted
as zeros rather than excluded.

---

## 5. Keeping Course Hub the single source

**The rule: every fact has exactly one writer.** Course Hub writes students,
enrollments, courses and the tables that organise them. Other apps read them,
directly or through Course Hub's API, or receive a copy that the database
maintains for them. Two writers means two sets of assumptions drifting apart
with nothing forcing them to agree.

### Who writes what — measured 2026-10-20

Measured from code (every `.from(...)` insert, update, upsert and delete in
each repo) and from the triggers in the 2026-09-23 schema snapshot. Re-measure
after changes rather than trusting this table.

| Fact | Owner | Written by, in practice |
|---|---|---|
| `students` | Course Hub | Course Hub only. The Report Card Tool's Students page also added students and edited gender and grade until 2026-10-20; it is now read-only. |
| `enrollments` | Course Hub | Course Hub only. That same Report Card Tool page deleted and re-inserted each saved student's enrollments for the year, dropping `grade_year`, until 2026-10-20. TOC Day Plans' class-lists page inserted enrollments until it was deleted on 2026-09-24 (toc-dayplans `1c28d5e`). |
| `courses`, `school_quarters`, `student_notes`, `student_marks` | Course Hub | Course Hub (`/courses`, `/quarters`, `/students`). |
| `learning_standards`, `learning_standard_rubrics`, `school_documents` | Course Hub | Course Hub (`/standards`, `/documents`). The Report Card Tool's standards editor writes its own `rcs.learning_standards`, not these. |
| `teaching_groups`, `course_catalog`, `school_years` | Course Hub | **No app.** Course Hub has no screen for them, so they change only by SQL. See "What's left". |
| `classes` | Nobody — generated | Rebuilt from each teaching group and its courses by `sync_class_from_teaching_group` (triggers `courses_sync_class`, `teaching_groups_sync`). See below. |
| `enrollments.class_id` | Nobody — generated | `trg_enrollments_fill_course_class` derives it from `course_id`, which is authoritative. |
| `rcs.enrollments` for linked courses | Nobody — generated | `trg_sync_rcs_enrollment` copies public → rcs, keyed on course through `rcs.course_hub_links`. The Report Card Tool's "link course" action also backfills once, into its own schema. |
| `rcs.*` (courses, comments, surveys, …) | Report Card Tool | Report Card Tool: its own reporting setup, tied to Course Hub courses through `course_hub_links`. |
| `class_course_links` | TOC Day Plans | TOC only (`src/app/api/admin/classes/route.ts`). It repeats what `teaching_group_id` already records. |

How the other apps read:

- **Group Maker and KawaHoot** make no direct table calls. They use Course
  Hub's API (`/api/courses`, `/api/courses/[id]/roster`, `/api/students`),
  which requires an API key (`src/lib/require-api-key.ts`). KawaHoot's game
  data lives in its own database.
- **Report Card Tool** reads `students`, `courses` and `enrollments` directly,
  and the API through its `app/api/course-hub/*` routes.
- **TOC Day Plans** reads `classes`, `courses` and `school_quarters` directly,
  and the attendance sheet through `/api/attendance`.

### `classes` stays, as a generated and locked table

`classes` models the **teaching block**, what happens in one room at one time.
`courses` models the **reporting unit** used for report cards:

| `public.classes` (taught together) | `public.courses` (reported separately) |
|---|---|
| `Band 10-12` | `Band 10`, `Band 11`, `Band 12` |
| `Computer Programming 11/12` | `CP 11`, `CP 12` |
| `Worship Leadership 11/12` | `WL 11`, `WL 12` |

A teaching group records which courses are taught together, and the database
keeps one `classes` row per group. `trg_classes_guard` rejects any change to
the mirrored columns (`name`, `block_label`, `active_quarters`, `school_year`,
`teaching_group_id`) that doesn't come from that sync, with an error telling
the caller to change the course or its teaching group instead.

So `classes` is no longer a competing source of truth, and **it is kept**
(decided 2026-10-20). This replaces the earlier plan to repoint TOC to teaching
groups and drop it. Day plans hang off `classes`: at last count
`day_plan_blocks.class_id` (138), `toc_block_plans.class_id` (125) and
`class_toc_templates.class_id` (14). Dropping it would mean rewriting those and
TOC's RPCs without changing who owns anything.

Columns the guard lets apps write:

- `toc_template_id`: TOC's pointer to the class's template (toc-dayplans
  ADR-0005). TOC-owned data that happens to live on this table.
- `grade_level`: set in TOC's admin. It repeats `courses.grade_years`; see
  "What's left".
- `room`, `sort_order`: copied from the group's courses on every sync, so an
  edit made on `classes` is overwritten the next time a course in the group
  changes. Change them on the course.

### The enrollment sync, then and now

The original `sync_rcs_enrollment` sat on `rcs.enrollments` and copied rcs →
public. It was dropped. It resolved its targets **by block**, so one rcs
enrollment would land in every class sharing that block (the mechanism behind
the fabricated 36/36/36 block H rosters in §4). Its `ON CONFLICT` had no
matching unique constraint, so every insert failed, and it took the school year
from `NOW()`. The replacement, same function name, is on `public.enrollments`.
It runs public → rcs and keys on **course** through `rcs.course_hub_links`.

### The 181 legacy enrollments are duplicates, not gaps

These are the `public.enrollments` rows with a `class_id` but no `course_id`.
Each points at a legacy `classes` row with a null `school_year`, so no
year-filtered view shows them.

The obvious reading of "283 of 464 migrated" is that 181 rows still need
moving. They do not. Comparing (student, block) pairs across both sets:

| | pairs |
|---|---|
| Legacy (`class_id`) | 181 |
| Migrated (`course_id`) | 185 |
| Present in both | **181** |
| Legacy only | **0** |

Every legacy enrollment is already represented by a `course_id` row for the
same student in the same block. Migrating them would not fill a gap — it would
**double every roster**. The correct action is to delete them.

This matters beyond tidiness: any count over `public.enrollments` that does not
filter on `course_id is not null` is currently inflated. The four extra migrated
pairs are enrollments added after the migration ran.

### What's left (2026-10-20)

In order; each step is safe on its own.

1. **A teaching-group screen in Course Hub**, before the 2027-28 timetable.
   Until then a new course needs its teaching group made in SQL. Without one,
   the database builds no `classes` row for it, TOC can't see it, and its
   enrollments get no `class_id`. `school_years` and `course_catalog` have the
   same gap, less urgently.
2. **Grade in one place.** TOC's `classes.grade_level` should come from the
   group's courses instead of being typed in TOC. Separately, enrollments added
   in Course Hub (`toggleEnrollment` and `toggleEnrollmentInline` in
   `StudentsClient.tsx`) are inserted without `grade_year`, and the fill
   trigger doesn't set it, so new rows lack the per-year grade §2 relies on.
3. **TOC: replace `class_course_links`** with a join on `teaching_group_id`,
   then drop the table.
4. **Delete the legacy `class_id`-only enrollments**, after a backup
   (`supabase-local/backup-local-db.sh`) and both checks below.
5. **Then make `enrollments.course_id` NOT NULL**, so course is authoritative
   by constraint, not only by trigger.
6. **Drop `rcs.students`** (test data, §1 #5) once nothing references it. No
   Report Card Tool code reads it (checked 2026-10-20); check foreign keys
   first.

Checks before step 4, in the shared stack's Supabase Studio:

```sql
-- legacy rows remaining (was 181)
select count(*) from public.enrollments where course_id is null;

-- legacy rows with no migrated twin for the same student and block (must be 0)
select count(*)
from public.enrollments l
join public.classes lc on lc.id = l.class_id
where l.course_id is null
  and not exists (
    select 1
    from public.enrollments m
    join public.courses mc on mc.id = m.course_id
    where m.student_id = l.student_id
      and lc.block_label in (mc.block, mc.block_label)
  );
```

---

## 6. Security model

Current policies grant every authenticated user unrestricted access to all
student data. Two changes:

**Scope by teacher.** A teacher reads the offerings they teach and the students
enrolled in them; an admin role sees everything.

```sql
create policy "teacher reads own offerings"
  on course_offerings for select to authenticated
  using (teacher_id = auth.uid() or is_admin());

create policy "teacher reads enrolled students"
  on enrollments for select to authenticated
  using (exists (
    select 1 from course_offerings o
    where o.id = enrollments.offering_id
      and (o.teacher_id = auth.uid() or is_admin())
  ));
```

**Make past years read-only.** Once a year is archived, writes are refused at
the database level, so a stray UI action cannot rewrite a completed year:

```sql
create policy "no writes to archived years"
  on enrollments for all to authenticated
  using (true)
  with check (not exists (
    select 1 from course_offerings o join school_years y on y.code = o.school_year
    where o.id = enrollments.offering_id and y.is_archived
  ));
```

This is the single highest-value safeguard for a multi-year archive: history
becomes structurally immutable rather than immutable by convention.

---

## 6. The yearly rollover

With this model, starting a new year is a routine operation rather than a
schema edit:

1. Insert the new `school_years` row; set `is_current`.
2. Copy forward the offerings that repeat, editing block/room as the timetable
   changes. Courses themselves are untouched.
3. Import the year's students — matching existing people by `student_number`
   so returners keep their identity — and create enrollments.
4. Archive the prior year.

Steps 2–4 are worth a `roll_over_year()` function once the shape settles.

---

## 7. Migration path

Ordered so that each step is independently safe and reversible.

| Step | Change | Risk |
|---|---|---|
| 1 | Create `school_years`, backfill from distinct strings in use | None — additive |
| 2 | Create `course_offerings`, backfill from `rcs.courses` × `course_blocks` | None — additive |
| 3 | Point the app at `course_offerings`; keep old tables in place | Low — reversible by redeploy |
| 4 | Add `offering_id` to `enrollments`/`assignments`, backfill, then add FKs | Medium — needs care with the 1 orphan enrollment |
| 5 | Consolidate `rcs.students` into `public.students`; drop `students.school_year` | Medium — do while only one year of data exists |
| 6 | Replace flat RLS with scoped policies + archive enforcement | Medium — test with a non-admin account first |
| 7 | Retire `rcs.courses` / `rcs.students` | Low — after 3–6 are proven |

**Step 5 is time-sensitive.** Only 2025-26 data exists today, and no student
name repeats. Splitting one student into per-year rows has not happened yet, so
fixing identity now costs almost nothing. After a second year is imported it
becomes a genuine data-reconciliation project.
