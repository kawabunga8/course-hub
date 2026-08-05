import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/courses/[id]/roster
// Returns the student roster for a course.
// Response: [{ id, first_name, last_name, full_name, email }]
// PIPA: only fields needed for teaching use — no address, DOB, or other PII.
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
    .select('id,first_name,last_name,email')
    .in('id', studentIds)
    .order('last_name')

  if (studentsError) {
    return NextResponse.json({ error: studentsError.message }, { status: 500 })
  }

  return NextResponse.json(
    (students ?? []).map((s: { id: string; first_name: string; last_name: string; email: string | null }) => ({
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      full_name: `${s.first_name} ${s.last_name}`,
      email: s.email,
    }))
  )
}
