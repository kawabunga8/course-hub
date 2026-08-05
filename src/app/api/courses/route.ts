import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { createAdminClient } from '@/lib/supabase/admin'
import { currentSchoolYear, resolveCurrentQuarter } from '@/lib/school-year'

// GET /api/courses?school_year=2026-27&quarter=3&type=academic
// Returns courses for the given school year filtered to the current quarter.
// Consuming apps: KawaHoot, group-maker, toc-dayplans, report-card-tool.
export async function GET(req: NextRequest) {
  const auth = requireApiKey(req)
  if (auth) return auth

  const { searchParams } = req.nextUrl
  const schoolYear = searchParams.get('school_year') || currentSchoolYear()
  const typeFilter = searchParams.get('type') // e.g. 'academic' — optional

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

  const currentQuarter = resolveCurrentQuarter(quarters ?? [])

  const filtered = (courses ?? [])
    .filter((c: { type: string }) => !typeFilter || c.type === typeFilter)
    .filter((c: { quarters: string[] | null }) =>
      !currentQuarter || !c.quarters || c.quarters.includes(String(currentQuarter))
    )
    .map((c: {
      id: string; name: string; block: string | null; grade_years: number[]
      school_year: string | null; type: string; room: string | null
    }) => ({
      id: c.id,
      name: c.name,
      block: c.block,
      grade_years: c.grade_years,
      school_year: c.school_year,
      type: c.type,
      room: c.room,
    }))

  return NextResponse.json(filtered)
}
