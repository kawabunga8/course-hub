import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { createAdminClient } from '@/lib/supabase/admin'
import { currentSchoolYear, resolveCurrentQuarter } from '@/lib/school-year'

// Quarters are stored as free text (the Courses screen offers "e.g. Q1, Q2"), so a
// course may carry "Q1" or "1" depending on who typed it, while resolveCurrentQuarter
// returns a number. Comparing those directly meant "Q1" never matched 1 and every
// quarter-scoped course — ICT 9 Q1, Computer Studies 10 Q3/Q4 — was silently dropped
// from this endpoint. Compare on digits so any of those spellings agree.
function quarterKey(q: string | number | null): string {
  return String(q ?? '').replace(/[^0-9]/g, '')
}

// GET /api/courses?school_year=2026-27&quarter=3&type=academic
// Returns courses for the given school year.
//
// quarter: a specific quarter ("3" or "Q3") to filter to, or "all" for every course
// in the year. Omitted keeps the previous behaviour of filtering to whatever quarter
// is running today. The parameter was documented here but never read, so callers
// asking for a specific quarter silently got today's instead — which is wrong for
// the Report Card Tool, where a teacher writes Q2 comments during Q3.
//
// quarters is returned on each course. Consumers need it to tell a full-year course
// from a quarter-scoped one; without it the Report Card Tool could not detect that a
// Q1-only course gives its final report in Q1.
//
// Consuming apps: KawaHoot, group-maker, toc-dayplans, report-card-tool.
export async function GET(req: NextRequest) {
  const auth = requireApiKey(req)
  if (auth) return auth

  const { searchParams } = req.nextUrl
  const schoolYear = searchParams.get('school_year') || currentSchoolYear()
  const typeFilter = searchParams.get('type') // e.g. 'academic' — optional
  const quarterParam = searchParams.get('quarter') // '3', 'Q3', or 'all' — optional

  const supabase = createAdminClient()

  const [{ data: courses, error: coursesError }, { data: quarters, error: quartersError }] =
    await Promise.all([
      supabase.rpc('current_courses', { p_school_year: schoolYear }),
      supabase.from('school_quarters').select('id,start_date,end_date').eq('school_year', schoolYear),
    ])

  if (coursesError) {
    return NextResponse.json({ error: coursesError.message }, { status: 500 })
  }
  if (quartersError) {
    return NextResponse.json({ error: quartersError.message }, { status: 500 })
  }

  // 'all' disables quarter filtering; an explicit quarter wins over today's.
  const wantsAllQuarters = quarterParam?.toLowerCase() === 'all'
  const requestedQuarter = wantsAllQuarters ? null : quarterKey(quarterParam) || null
  const activeQuarter = requestedQuarter ?? quarterKey(resolveCurrentQuarter(quarters ?? []))

  const filtered = (courses ?? [])
    .filter((c: { type: string }) => !typeFilter || c.type === typeFilter)
    .filter((c: { quarters: string[] | null }) =>
      // A course with no quarters runs all year and always qualifies.
      wantsAllQuarters || !activeQuarter || !c.quarters?.length ||
      c.quarters.some(q => quarterKey(q) === activeQuarter)
    )
    .map((c: {
      id: string; name: string; block: string | null; grade_years: number[]
      school_year: string | null; type: string; room: string | null
      quarters: string[] | null
    }) => ({
      id: c.id,
      name: c.name,
      block: c.block,
      grade_years: c.grade_years,
      school_year: c.school_year,
      type: c.type,
      room: c.room,
      quarters: c.quarters,
    }))

  return NextResponse.json(filtered)
}
