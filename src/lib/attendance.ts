import type { SupabaseClient } from '@supabase/supabase-js';
import { quarterForDate, quarterKey } from '@/lib/school-year';

// Builds a TOC attendance sheet: every course that runs in one block, each with
// its enrolled students. Shared by the /courses/attendance page (browser client,
// teacher's session) and GET /api/attendance (admin client, for TOC Day Plans),
// so both produce the same sheet. Names and grade only — never photos, emails,
// notes or marks.

export type AttendanceCourse = {
  id: string;
  name: string;
  block: string | null;
  grade_years: number[];
  school_year: string | null;
  room: string | null;
  sort_order: number | null;
  quarters: string[] | null;
};

export type AttendanceStudent = { id: string; first_name: string; last_name: string; grade_year: number | null };

export type AttendanceSection = { course: AttendanceCourse; students: AttendanceStudent[] };

export type Quarter = { label: string; start_date: string | null; end_date: string | null };

function byName(a: AttendanceStudent, b: AttendanceStudent) {
  return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
}

// Courses and quarters for a year, courses in display order.
export async function loadYearCourses(sb: SupabaseClient, year: string) {
  const [{ data, error }, { data: qs, error: qErr }] = await Promise.all([
    sb.rpc('current_courses', { p_school_year: year }),
    sb.from('school_quarters').select('label,start_date,end_date').eq('school_year', year),
  ]);
  if (error || qErr) throw (error ?? qErr)!;
  const courses = ((data ?? []) as AttendanceCourse[]).sort((a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  return { courses, quarters: (qs ?? []) as Quarter[] };
}

// The courses in `block` to list for `date`. Only filters by quarter when
// onlyRunning is set and a quarter covers the date; otherwise there's nothing to
// filter by, and callers say so rather than silently dropping courses.
export function selectBlockCourses(
  courses: AttendanceCourse[], quarters: Quarter[], block: string, date: string, onlyRunning: boolean,
) {
  const dateQuarter = quarterForDate(quarters, date);
  const filtering = onlyRunning && !!dateQuarter;
  const blockCourses = courses.filter(c =>
    c.block === block &&
    // A course with no quarters runs all year.
    (!filtering || !c.quarters?.length || c.quarters.some(q => quarterKey(q) === quarterKey(dateQuarter)))
  );
  const hiddenCount = courses.filter(c => c.block === block).length - blockCourses.length;
  return { blockCourses, dateQuarter, filtering, hiddenCount };
}

// Rosters for every course in the chosen block.
export async function loadBlockSections(
  sb: SupabaseClient, block: string, blockCourses: AttendanceCourse[], year: string,
): Promise<AttendanceSection[]> {
  if (!blockCourses.length) return [];

  // Editing a course creates a new row and supersedes the old one, so
  // enrollments may still point at an older version. Resolve every row in
  // this block to the current version it was replaced by.
  const { data: allRows, error: rowsErr } = await sb
    .from('courses').select('id,superseded_by').eq('block', block);
  if (rowsErr) throw rowsErr;
  const next = new Map<string, string | null>();
  for (const r of (allRows ?? []) as { id: string; superseded_by: string | null }[]) next.set(r.id, r.superseded_by);
  const currentIds = new Set(blockCourses.map(c => c.id));
  const resolve = (id: string): string | null => {
    let cur: string | null = id;
    for (let i = 0; cur && i < 50; i++) {
      if (currentIds.has(cur)) return cur;
      cur = next.get(cur) ?? null;
    }
    return null;
  };
  const idToCurrent = new Map<string, string>();
  for (const id of next.keys()) {
    const cur = resolve(id);
    if (cur) idToCurrent.set(id, cur);
  }

  const { data: enrolls, error: enErr } = await sb
    .from('enrollments').select('student_id,course_id,school_year')
    .in('course_id', Array.from(idToCurrent.keys()));
  if (enErr) throw enErr;

  const courseById = new Map(blockCourses.map(c => [c.id, c]));
  const studentsByCourse = new Map<string, Set<string>>();
  for (const e of (enrolls ?? []) as { student_id: string; course_id: string; school_year: string | null }[]) {
    const cur = idToCurrent.get(e.course_id);
    if (!cur) continue;
    // An enrollment with no year only counts when the course itself is
    // specific to this year; otherwise it can't be placed in a year.
    const inYear = e.school_year === year || (e.school_year == null && courseById.get(cur)?.school_year === year);
    if (!inYear) continue;
    if (!studentsByCourse.has(cur)) studentsByCourse.set(cur, new Set());
    studentsByCourse.get(cur)!.add(e.student_id);
  }

  const studentIds = Array.from(new Set(Array.from(studentsByCourse.values()).flatMap(s => Array.from(s))));
  let studentMap = new Map<string, AttendanceStudent>();
  if (studentIds.length) {
    const { data: studs, error: stErr } = await sb
      .from('students').select('id,first_name,last_name,grade_year').in('id', studentIds);
    if (stErr) throw stErr;
    studentMap = new Map(((studs ?? []) as AttendanceStudent[]).map(s => [s.id, s]));
  }

  return blockCourses.map(course => ({
    course,
    students: Array.from(studentsByCourse.get(course.id) ?? [])
      .map(id => studentMap.get(id))
      .filter((s): s is AttendanceStudent => !!s)
      .sort(byName),
  }));
}
