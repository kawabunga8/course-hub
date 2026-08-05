import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/students?grade_year=11&search=smith
// Returns students, optionally filtered by grade year or name search.
// PIPA: returns only fields needed for teaching use. No DOB, address, or
// other sensitive fields. Consumers must not store this data permanently.
export async function GET(req: NextRequest) {
  const auth = requireApiKey(req)
  if (auth) return auth

  const { searchParams } = req.nextUrl
  const gradeYear = searchParams.get('grade_year')
  const search = searchParams.get('search')

  const supabase = createAdminClient()

  let query = supabase
    .from('students')
    .select('id,first_name,last_name,email,grade_year')
    .order('last_name')

  if (gradeYear) query = query.eq('grade_year', Number(gradeYear))
  if (search) query = query.ilike('last_name', `${search}%`)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    (data ?? []).map((s: {
      id: string; first_name: string; last_name: string
      email: string | null; grade_year: number | null
    }) => ({
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      full_name: `${s.first_name} ${s.last_name}`,
      email: s.email,
      grade_year: s.grade_year,
    }))
  )
}
