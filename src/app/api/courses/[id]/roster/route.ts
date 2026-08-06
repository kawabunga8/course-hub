import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/courses/[id]/roster
// Returns the student roster for a course.
// Response: [{ id, first_name, last_name, full_name, email, gender, grade_year,
//              grade_year_reference }]
//
// gender and grade_year are teaching-essential and were previously omitted, which
// broke consumers silently rather than loudly. The Report Card Tool derives
// pronouns from gender and fell back to they/them for every student on the
// roster, so generated comments could misgender the child they were written
// about; it also had no grade to write to grade-level expectations against.
//
// grade_year_reference is students.school_year — the year the grade was recorded
// in. Course Hub stores ONE grade per student, not a grade per year, so a grade
// is only true for its reference year. Returning the pair lets a consumer asking
// about an earlier year tell that it does not know that year's grade, instead of
// quietly presenting today's grade as though it were historical.
//
// PIPA: still only fields needed for teaching use — no address, DOB, or other PII.
// A course row is specific to one school year, so filtering enrollments by
// course_id is already year-scoped.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireApiKey(req)
  if (auth) return auth

  const { id } = await params
  const supabase = createAdminClient()

  const { data: enrollments, error: enrollError } = await supabase
    .from('enrollments')
    .select('student_id')
    .eq('course_id', id)

  if (enrollError) {
    return NextResponse.json({ error: enrollError.message }, { status: 500 })
  }
  if (!enrollments?.length) {
    return NextResponse.json([])
  }

  const studentIds = enrollments.map((e: { student_id: string }) => e.student_id)

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id,first_name,last_name,email,gender,grade_year,school_year')
    .in('id', studentIds)
    .order('last_name')

  if (studentsError) {
    return NextResponse.json({ error: studentsError.message }, { status: 500 })
  }

  return NextResponse.json(
    (students ?? []).map((s: {
      id: string; first_name: string; last_name: string; email: string | null
      gender: string | null; grade_year: number | null; school_year: string | null
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
