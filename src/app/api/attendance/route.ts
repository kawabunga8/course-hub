import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { createAdminClient } from '@/lib/supabase/admin'
import { currentSchoolYear } from '@/lib/school-year'
import { loadBlockSections, loadYearCourses, selectBlockCourses } from '@/lib/attendance'

// GET /api/attendance?block=A&date=2026-09-30[&year=2026-27][&all=1]
// The TOC attendance sheet for one block on one date — the same sheet as the
// /courses/attendance page (built by @/lib/attendance). Used by TOC Day Plans to
// add the sheet to a day plan.
// Response: { block, date, year, quarter, filtering, hiddenCount,
//             sections: [{ course: { id, name, room, quarters, ... },
//                          students: [{ id, first_name, last_name, grade_year }] }] }
//
// PIPA: names and grade only — no email, gender, photo, notes or marks. RCS
// approved sending these class lists to substitutes (2026-09-30).
export async function GET(req: NextRequest) {
  const auth = requireApiKey(req)
  if (auth) return auth

  const u = new URL(req.url)
  const block = (u.searchParams.get('block') ?? '').trim()
  const date = (u.searchParams.get('date') ?? '').trim()
  const year = (u.searchParams.get('year') ?? '').trim() || currentSchoolYear()
  const onlyRunning = u.searchParams.get('all') !== '1'
  if (!block) return NextResponse.json({ error: 'Missing block' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })

  try {
    const sb = createAdminClient()
    const { courses, quarters } = await loadYearCourses(sb, year)
    const { blockCourses, dateQuarter, filtering, hiddenCount } =
      selectBlockCourses(courses, quarters, block, date, onlyRunning)
    const sections = await loadBlockSections(sb, block, blockCourses, year)
    return NextResponse.json({ block, date, year, quarter: dateQuarter, filtering, hiddenCount, sections })
  } catch (e) {
    return NextResponse.json({ error: (e as { message?: string })?.message ?? String(e) }, { status: 500 })
  }
}
