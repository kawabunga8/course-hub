---
status: proposed
date: 2026-09-18
---

# Learning evidence is recorded as append-only, xAPI-shaped statements in Course Hub

Every app in the suite that produces evidence of learning will send it to
Course Hub as a **statement** — *who* did *what* to *which thing*, with *what
result*, in *what context* — shaped after the xAPI (Experience API) standard.
Course Hub stores these in one table that is added to and never edited. It
becomes the career-long learning record that `ARCHITECTURE.md` sets as its goal.

This is a design decision only. Nothing here has been built.

## Context

Course Hub already owns *who* students are and *what* they are enrolled in. It
does not own a coherent record of *what they have shown they can do*. That
evidence is scattered, and each piece has a different weakness:

| Where evidence lives today | Weakness |
| --- | --- |
| `public.student_marks` | `subject` is free text; `quarter` is free text; `class_id` points at `classes`, which is being retired |
| `public.student_notes` | Untyped text; not tied to a course, standard or year |
| Report Card Tool (`rcs` schema) | Separate schema, separate enrolments; standards reached through `public_standard_id` |
| KawaHoot `answers` | Players are identified by nickname / `real_name`, **not** by `student_id`, so answers cannot be attributed to a person |

So the question *"how has this student grown on PROTOTYPE from CS 10 to
CP 12?"* cannot be answered today. Answering it would mean joining four
differently-shaped sources, and the answer would get harder with each new app.

Two pieces of the foundation are already in place:

- **Stable student identity.** One row per person across years (ARCHITECTURE §1, #3 resolved).
- **Stable, versioned standards.** `learning_standards` rows are never edited once
  referenced; a change creates a new row. A statement that points at a standard
  row therefore keeps the exact wording the student was assessed against.

## Decision

### One table, one shape

A new `public.learning_statements` table. Each row is one statement:

| Part | Column(s) | Example |
| --- | --- | --- |
| Actor | `student_id` (FK → `students`) | the student |
| Verb | `verb` (from a controlled list — see below) | `assessed` |
| Object | `object_type`, `object_id` | `learning_standard`, the versioned standard row for `prototype_and_test` |
| Result | `result_level`, `result_plus`, `result_insufficient_evidence`, `result_score`, `result_success`, `result_note` | Proficient, plus = yes |
| Context | `course_id` (later `offering_id`), `school_year`, `quarter`, `source_app`, `recorded_by` | CS 10 · 2026-27 · Q1 · report-card-tool · Kawamura |
| Evidence | `evidence_path` (Storage) | a photo of the prototype |
| Time | `occurred_at` (when it happened), `stored_at` (when it was recorded) | |
| Correction | `voids` (FK → another statement) | |

### Proficiency levels

*Decided 2026-09-18.* `result_level` is one of the four rubric levels:
`emerging`, `developing`, `proficient`, `extending`. It matches
`learning_standard_rubrics.level`, so every level points at real rubric text.

- **Plus** is a separate yes/no, `result_plus`. Report-card *Proficient+* is
  stored as `proficient` with `result_plus = true`. The distinction is kept
  without inventing rubric levels that have no rubric text.
- **IE (insufficient evidence)** is stored as `result_insufficient_evidence = true`
  with no level. It is a real statement: the teacher looked and could not
  judge, which is different from never having assessed.
- **Developing** stays available. RCS report cards do not currently use it, but
  other evidence (e.g. `observed`) may.

The columns are ordinary database columns, so they can be queried and
protected with row-level security. A full xAPI JSON statement can be generated
from any row on export. The table does not store raw JSON as the record of truth.

### Append-only, corrected by voiding

Rows are never updated or deleted. A mistake is corrected by a new statement
that **voids** the old one. This is xAPI's own correction mechanism. It keeps
an honest history and fits the archive rule in ARCHITECTURE §6: past years
become read-only at the database level.

### Apps write through Course Hub's API, not the table

Other apps send statements to a new `POST /api/statements` route. It uses the
same API-key pattern as `/api/courses` and `/api/students`. Course Hub checks
that the student exists, the verb is allowed and the object exists before
storing anything. ADR-0004 in toc-dayplans found that five of the eight shared
tables already have more than one writer. This table starts with exactly one.

### A small, stated vocabulary

Each verb must come with a reason for recording it. In class, everything is
done for a reason and the reason is stated; the same rule applies to the data.

| Verb | Sent by | Why it is recorded |
| --- | --- | --- |
| `assessed` | Report Card Tool, Course Hub | The core of reporting: a judgement against a standard |
| `observed` | Course Hub | Teacher-witnessed evidence — especially embodied work (a build, a performance) that no screen captures |
| `answered` | KawaHoot | Formative check-for-understanding; only for players whose sign-in the server verified (`players.identity_verified`), never for roster picks or guests |
| `voided` | Any writer | Correction |

Where an ADL standard verb exists (`answered`, `voided`), its identifier is
used on export. RCS-specific verbs get identifiers under the Course Hub domain.

### What is deliberately *not* recorded

- **TOC Dayplans.** Plans describe teaching, not learning.
- **Group Maker.** Being put in a group is not evidence of anything.
- **Clicks, page views, logins, time-on-page.** No clickstream. It says little
  about learning and a lot about surveillance.
- **Unclaimed KawaHoot nicknames.** Nothing that cannot be attributed to a real
  student.

Adding a verb later means updating this ADR with its reason.

### Students can see their own record

A student-facing view shows each student every statement about themselves, and
nothing else. Data visibility should not only flow upward. If a record is kept
about someone, that person should be able to read it.

## Considered options

**Keep evidence in each app's own tables and join for reports.** Rejected.
Every new app adds another join with its own idea of identity, and KawaHoot's
answers cannot be joined to a student at all.

**Adopt a full external Learning Record Store (LRS) now.** Rejected *for now*.
It adds another service, another login and another copy of student data outside
the Supabase project. For one teacher's suite, that cost outweighs the
interoperability benefit. Because the table is xAPI-shaped, exporting to an LRS
later stays a small job rather than a redesign.

**Store raw xAPI JSON documents.** Rejected as the primary store. JSON is hard
to protect with row-level security and hard to query. It is produced on export
instead.

**xAPI-shaped relational table owned by Course Hub.** Chosen.

## Prerequisites

These come from the migration path in `ARCHITECTURE.md` and must land first or
alongside:

1. **Stable course codes** (§1, #9). Otherwise a statement's course context
   depends on a name that drifts.
2. **`school_years` as a table** (§1, #8). Otherwise `school_year` stays free
   text and a typo creates a phantom year inside the learning record.
3. **Scoped row-level security** (§6; migration step 6). Current policies let
   any signed-in account read every student. A detailed learning record must
   not inherit that. **This is a hard gate, not a follow-up.**
4. ✅ **KawaHoot identity linking** (done 2026-09-18). Players carry
   `student_id` and `identity_verified` in KawahootCA. KawaHoot's own tables are open to any caller
   (`using (true)`), so they can hold game state but must never be treated as
   the learning record.

## Consequences

- **Coverage is honest.** Statements exist only from the date each app starts
  sending them. ARCHITECTURE §4 applies: an empty record before adoption means
  *no records kept*, not *nothing learned*. No statements are invented to fill
  earlier periods.
- **Existing assessments.** `student_marks` is empty. The real history is
  `rcs.generated_comments` (191 report-card records, 2025-26), whose
  `proficiency_levels` map cleanly to Course Hub standards. These are imported
  once as `assessed` statements with `source_app = 'migrated'`. Only the
  levels are copied: IEP fields and comment text are never copied. See
  `docs/xapi-readiness-2026-09-18.md`.
- **Notes stay notes.** `student_notes` are private teacher jottings, not
  evidence shown to students. Only notes a teacher explicitly promotes become
  `observed` statements.
- **Minors and PIPA.** This is personal information about minors. The reason
  column in the vocabulary table is the stated purpose for each kind of
  collection. The retention period needs deciding (open question below).

## Rollout

1. Prerequisites 1–3.
2. Create `learning_statements` and `POST /api/statements`.
3. Report Card Tool sends `assessed` statements.
4. Course Hub UI for `observed` statements with photo evidence.
5. Student "My Record" view.
6. KawaHoot sends `answered`, after identity linking.
7. Optional: xAPI export to an external LRS.

## Open questions

- ~~**Region.**~~ **Resolved (2026-09-18):** the shared project ("kawabunga8's
  Project") is hosted in `ca-central-1` (Canada), on the Pro plan (daily backups).
- **KawaHoot's database.** A separate `KawahootCA` Supabase project exists. If
  KawaHoot's game data lives there rather than in the shared project, `answered`
  statements must cross projects through the API, which this design already
  requires.
- **Retention.** How long are statements kept after a student graduates or leaves?
- **Student sign-in.** How do students authenticate for "My Record"? A
  `students.email` column exists; a student sign-in flow may not.
- **Consent and communication.** What do students and families get told, and when?
- ~~**Rubric levels.**~~ Resolved: see *Proficiency levels* above.
