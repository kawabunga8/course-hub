import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/students?grade_year=11&school_year=2026-27&search=smith
// Returns students, optionally filtered by grade year, school year, or name search.
//
// gender is included for the same reason as on the roster endpoint: consumers
// derive pronouns from it, and omitting it made them fall back to they/them for
// every student without any signal that the data was simply missing.
//
// grade_year_reference is students.school_year — the year grade_year was recorded
// in. Course Hub holds one grade per student rather than a history, so a consumer
// asking about an earlier year needs the reference year to know whether the grade
// it received actually applies.
//
// school_year was previously accepted-and-ignored: callers passing it got every
// student back and had no way to tell the filter had not been applied.
//
// PIPA: returns only fields needed for teaching use. No DOB, address, or
// other sensitive fields. Consumers must not store this data permanently.
export async function GET(req: NextRequest) {
  const auth = requireApiKey(req)
  if (auth) return auth

  const { searchParams } = req.nextUrl
  const gradeYear = searchParams.get('grade_year')
  const schoolYear = searchParams.get('school_year')
  const search = searchParams.get('search')

  const supabase = createAdminClient()

  let query = supabase
    .from('students')
    .select('id,first_name,last_name,email,gender,grade_year,school_year')
    .order('last_name')

  if (gradeYear) query = query.eq('grade_year', Number(gradeYear))
  if (schoolYear) query = query.eq('school_year', schoolYear)
  if (search) query = query.ilike('last_name', `${search}%`)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    (data ?? []).map((s: {
      id: string; first_name: string; last_name: string
      email: string | null; gender: string | null
      grade_year: number | null; school_year: string | null
    }) => ({
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      full_name: `${s.first_name} ${s.last_name}`,
      email: s.email,
      gender: s.gender,
      grade_year: s.grade_year,
      grade_year_reference: s.school_year,
    }))
  )
}
