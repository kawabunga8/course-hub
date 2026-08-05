# Course Hub — Setup Guide

Course Hub is the central student data app for all RCS apps.
After this setup, **one student record = one source of truth** across:
- Course Hub (manage here)
- TOC-Dayplans
- RCS Report Card Tool
- Kawahoot
- Group Maker

---

## Step 1 — Run the SQL migrations in Supabase

Open your Supabase project SQL editor and run these files **in order**:

### 1a. Student data tool (adds notes + marks tables)
File: `../toc-dayplans/supabase/migrations/20260411000000_student_data_tool.sql`

### 1b. Kawahoot game tables (adds games, players, answers, etc.)
File: `kawahoot-game-tables.sql` (in this folder)

> These are all `IF NOT EXISTS` — safe to run multiple times.

---

## Step 2 — Create `.env.local` for each app

Copy the same three values into every app's `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=     ← from Supabase project settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY= ← "anon public" key
SUPABASE_SERVICE_ROLE_KEY=    ← "service_role" key (keep this secret!)
```

Apps that need these:
| App | File to create/update |
|---|---|
| course-hub | `course-hub/.env.local` |
| toc-dayplans | already has it |
| rcs-report-card-tool | already has it |
| Kawahoot | `Kawahoot/.env.local` — rename `SUPABASE_SECRET_KEY` → `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| group-maker | `group-maker/.env.local` — add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

### Kawahoot extra env vars
```
NEXT_PUBLIC_COURSE_HUB_URL=https://rcs-course-hub.vercel.app
```

### Group Maker extra env vars
```
NEXT_PUBLIC_COURSE_HUB_URL=https://rcs-course-hub.vercel.app
NEXT_PUBLIC_KAWAHOOT_URL=https://your-kawahoot.vercel.app
```

---

## Step 3 — Install dependencies and run Course Hub

```bash
cd course-hub
npm install
npm run dev   # runs on localhost:3000
```

---

## Step 4 — Migrate existing Kawahoot/Group Maker students

If you had students in the old Kawahoot/Group Maker database, you need to move them.

The easiest way is to **export them as CSV** from the old Supabase project and **import via Course Hub** (⬆ Import CSV button). The import accepts:
- `first_name`, `last_name` columns  
- OR a `full_name` column (auto-split on first space)

---

## Step 5 — Deploy

Deploy course-hub to Vercel just like your other apps:
1. Push to GitHub
2. Import in Vercel
3. Set the three env vars in Vercel project settings
4. Done — the other apps reach it at the stable alias `rcs-course-hub.vercel.app`
   via `NEXT_PUBLIC_COURSE_HUB_URL`. Use that alias rather than the
   project-name domain, which moves if the Vercel project is renamed.

> **Do not confuse this with `NEXT_PUBLIC_HUB_SUPABASE_URL`** in
> rcs-report-card-tool. That one is the Supabase project URL, not this site.
> It was previously called `NEXT_PUBLIC_STUDENT_HUB_URL`, which collided with
> the site URL of the same name in toc-dayplans.

---

## How it all connects

```
Course Hub  ──writes──▶  public.students  (Supabase)
                          public.classes
                          public.enrollments
                          public.student_notes
                          public.student_marks
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        TOC-Dayplans   RCS Report    Kawahoot + Group Maker
        (reads/writes) Card Tool     (reads only)
                       (reads/writes)
```
