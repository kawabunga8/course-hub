import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { createAdminClient } from '@/lib/supabase/admin'
import { currentSchoolYear } from '@/lib/school-year'

// GET /api/quarters?school_year=2026-27
// Returns school quarters for the given year, ordered by start date.
export async function GET(req: NextRequest) {
  const auth = requireApiKey(req)
  if (auth) return auth

  const schoolYear = req.nextUrl.searchParams.get('school_year') || currentSchoolYear()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('school_quarters')
    .select('id,label,start_date,end_date,school_year')
    .eq('school_year', schoolYear)
    .order('start_date')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
