# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server on localhost:3000
npm run build    # production build
npm run lint     # ESLint check
```

No test suite is configured.

## Environment Variables

Create `.env.local` with:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Architecture

**Course Hub** is a Next.js 16 App Router app that serves as the central student data source for a suite of RCS (Richmond Christian School) tools: TOC-Dayplans, RCS Report Card Tool, Kawahoot, and Group Maker. It writes to a shared Supabase database; the other apps read from it.

### Supabase tables (managed here)
- `public.students` — core student records (name, grade, gender, photo_url, student_number)
- `public.classes` — class definitions with block_label and sort_order
- `public.enrollments` — many-to-many students ↔ classes
- `public.student_notes` — per-student timestamped notes
- `public.student_marks` — per-student subject marks with quarter and class references

Photos are stored in the Supabase Storage bucket **"Student Photos"**.

### AI & student data (if adding an AI feature here)
Course Hub doesn't call any AI provider today, but it owns sensitive per-student tables (`student_notes`, `student_marks`). Standing RCS rule: Claude is fine for features with no student data in the prompt; anything that would send individual student records/notes to an AI must use a locally-run model instead (see rcs-report-card-tool's `CLAUDE.md` "AI Generation"/"AI Roadmap" sections for the established pattern — env-var-gated Ollama fallback, dynamic model field, explicit `num_ctx`).

### Supabase client pattern
- **Browser (client components):** use `getSupabaseClient()` from `src/lib/supabaseClient.ts` — singleton `createBrowserClient` instance, throws if called server-side.
- **Middleware:** `createServerClient` from `@supabase/ssr` using `req.cookies`.
- There is no server-side Supabase helper; all data fetching happens client-side in `StudentsClient`.

### Auth flow
`middleware.ts` guards all routes except `/login`, `/auth/callback`, and `/api/*`. Unauthenticated requests redirect to `/login?next=<path>`. After sign-in or password reset, `/auth/callback/page.tsx` handles the `onAuthStateChange` event and redirects accordingly.

### Page structure
Each route uses a thin Server Component page that wraps a `*Client.tsx` component in `<Suspense>`. All business logic and data fetching lives in the client components.

- `/` — redirects to `/students` (root page)
- `/login` — email/password sign-in + forgot password (sends reset email to `/auth/callback`)
- `/students` — main app: student list, search/filter, detail panel with tabs (Info, Classes, Notes, Marks), CSV import, photo upload

### Styling
No CSS framework. All styles are inline using the `RCS` colour palette constant defined locally in each component:
```ts
const RCS = {
  deepNavy: '#1F4E79', midBlue: '#2E75B6', lightBlue: '#D6E4F0',
  gold: '#C9A84C', paleGold: '#FDF3DC', white: '#FFFFFF', textDark: '#1A1A1A',
}
```
