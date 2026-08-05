# course-hub — Agent Context

## What this app is
The **central student data hub** for all RCS apps. This is the single place where
students, classes, enrollments, notes, and marks are managed. All other apps read
from the same Supabase tables this app writes to.

## Tech stack
- Next.js 16 (App Router) + TypeScript
- Supabase (shared project with all other RCS apps)
- Auth: Supabase email/password, protected by middleware + `is_staff()` RLS check

## Commands
```bash
npm install     # first time only
npm run dev     # localhost:3000
npm run build   # production build
npm run lint    # ESLint check
```

## Key files
```
src/app/students/StudentsClient.tsx   ← main UI (directory, edit, enroll, notes, marks)
src/app/login/LoginClient.tsx         ← auth
src/lib/supabaseClient.ts             ← browser Supabase client
middleware.ts                         ← protects all routes except /login and /auth
```

## Database tables owned by this app
All in the `public` schema:
- `students` — id, first_name, last_name, photo_url, grade_year, gender, student_number
- `student_notes` — id, student_id, note, created_at, updated_at
- `student_marks` — id, student_id, subject, mark, quarter, class_id, note

Tables this app reads but shares with toc-dayplans:
- `classes` — courses/class definitions
- `enrollments` — student ↔ class membership

## Required env vars
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Migration SQL to run before first use
```
supabase/migrations/20260411000000_student_data_tool.sql  (student_notes, student_marks tables)
kawahoot-game-tables.sql  (Kawahoot game tables — run once in shared Supabase project)
```

## Health checks
- `npm run build` exits 0
- `/students` loads without auth errors
- `select count(*) from students` returns > 0 if students have been added

## Common issues
- **"Permission denied"** — missing or wrong `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **"Table does not exist"** — migration SQL hasn't been run in Supabase
- **Empty student list** — either no students added yet, or RLS policy is blocking anon reads

## Role in the ecosystem
- **Writes:** students, student_notes, student_marks, enrollments
- **Never writes:** Kawahoot game tables (games, players, answers, etc.)
- **Other apps depend on this:** always update student data here, never directly in other apps
