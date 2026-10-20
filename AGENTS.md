# course-hub — Agent Context

## What this app is
The central student and course data source for the RCS apps. The other apps
read what it writes.

This file is operational only and deliberately keeps no table list. It used to,
and the three docs drifted until they contradicted each other. Owned tables:
`CLAUDE.md`. Who actually writes what, measured from code: `ARCHITECTURE.md` §5.

## Tech stack
- Next.js 16 (App Router) + TypeScript
- Supabase: the local shared stack, `supabase-local/shared` (`http://127.0.0.1:54421`); see `CLAUDE.md` → Infrastructure
- Auth: Supabase email/password, protected by `src/middleware.ts` + `is_staff()` RLS check

## Commands
```bash
npm install     # first time only
npm run dev -- --port 3005   # the port the other RCS apps expect
npm run build   # production build
npm run lint    # ESLint check
```

## Key files
```
src/app/students/StudentsClient.tsx   ← main UI (directory, edit, enroll, notes, marks)
src/app/courses/CoursesClient.tsx     ← courses per school year
src/app/api/*/route.ts                ← read API for the other apps (API key: src/lib/require-api-key.ts)
src/app/login/LoginClient.tsx         ← auth
src/lib/supabaseClient.ts             ← browser Supabase client
src/lib/supabase/admin.ts             ← server client, API routes only
src/middleware.ts                     ← protects all routes except /login, /auth/callback and /api
```

## Required env vars
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Migrations
New files in `supabase/migrations/` are applied by hand in the shared stack's
Supabase Studio SQL editor. Nothing runs them automatically, and code that needs
a new column shows "column ... does not exist" until the migration is applied.

## Health checks
- `npm run build` exits 0
- `/students` loads without auth errors
- `select count(*) from students` returns > 0 if students have been added

## Common issues
- **"Permission denied"** — missing or wrong `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **"Table does not exist"** — migration SQL hasn't been run in Supabase
- **Empty student list** — either no students added yet, or RLS policy is blocking anon reads

## Role in the ecosystem
Other apps depend on this data: change students, enrollments and courses here,
never from another app.
