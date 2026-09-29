'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { currentSchoolYear, quarterForDate, quarterKey } from '@/lib/school-year';
import Banner from '@/components/Banner';

// Printable attendance sheet for a TOC: every course that runs in one block,
// each with its enrolled students. Printed or saved as PDF from the browser —
// nothing here is uploaded or shared, and it only shows names and grade, never
// photos, emails, notes or marks.

type Course = {
  id: string;
  name: string;
  block: string | null;
  grade_years: number[];
  school_year: string | null;
  room: string | null;
  sort_order: number | null;
  quarters: string[] | null;
};

type Student = { id: string; first_name: string; last_name: string; grade_year: number | null };

type Section = { course: Course; students: Student[] };

type Quarter = { label: string; start_date: string | null; end_date: string | null };

const KNOWN_YEARS = ['2025-26', '2026-27'];

const RCS = {
  deepNavy: '#1F4E79', midBlue: '#2E75B6', lightBlue: '#D6E4F0',
  gold: '#C9A84C', paleGold: '#FDF3DC', white: '#FFFFFF', textDark: '#1A1A1A',
} as const;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function byName(a: Student, b: Student) {
  return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
}

export default function AttendanceClient() {
  const router = useRouter();
  const params = useSearchParams();
  const year = params.get('year') || currentSchoolYear();
  const block = params.get('block') || '';
  const date = params.get('date') || todayLocal();
  // Default to just the courses running on the chosen date; ?all=1 lists every
  // course in the block whatever quarter it runs in.
  const onlyRunning = params.get('all') !== '1';

  const [courses, setCourses] = useState<Course[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`/courses/attendance?${next.toString()}`);
  }

  // Courses for the year — drives the block picker.
  useEffect(() => {
    let cancelled = false;
    setCoursesLoaded(false);
    (async () => {
      const sb = getSupabaseClient();
      const [{ data, error }, { data: qs, error: qErr }] = await Promise.all([
        sb.rpc('current_courses', { p_school_year: year }),
        sb.from('school_quarters').select('label,start_date,end_date').eq('school_year', year),
      ]);
      if (cancelled) return;
      if (error || qErr) { setError((error ?? qErr)!.message); setStatus('error'); return; }
      setQuarters((qs ?? []) as Quarter[]);
      setCourses(((data ?? []) as Course[]).sort((a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)));
      setCoursesLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [year]);

  const blocks = useMemo(() => {
    const seen: string[] = [];
    for (const c of courses) if (c.block && !seen.includes(c.block)) seen.push(c.block);
    return seen;
  }, [courses]);

  const dateQuarter = useMemo(() => quarterForDate(quarters, date), [quarters, date]);
  // Only filter when a quarter covers the date; otherwise there's nothing to
  // filter by, and the sheet says so rather than silently dropping courses.
  const filtering = onlyRunning && !!dateQuarter;

  const blockCourses = useMemo(() => courses.filter(c =>
    c.block === block &&
    // A course with no quarters runs all year.
    (!filtering || !c.quarters?.length || c.quarters.some(q => quarterKey(q) === quarterKey(dateQuarter)))
  ), [courses, block, filtering, dateQuarter]);
  const hiddenCount = courses.filter(c => c.block === block).length - blockCourses.length;

  // Rosters for every course in the chosen block.
  useEffect(() => {
    if (!coursesLoaded) return;
    if (!block || !blockCourses.length) {
      setSections([]);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    (async () => {
      setStatus('loading');
      setError(null);
      const sb = getSupabaseClient();
      try {
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
        let studentMap = new Map<string, Student>();
        if (studentIds.length) {
          const { data: studs, error: stErr } = await sb
            .from('students').select('id,first_name,last_name,grade_year').in('id', studentIds);
          if (stErr) throw stErr;
          studentMap = new Map(((studs ?? []) as Student[]).map(s => [s.id, s]));
        }

        if (cancelled) return;
        setSections(blockCourses.map(course => ({
          course,
          students: Array.from(studentsByCourse.get(course.id) ?? [])
            .map(id => studentMap.get(id))
            .filter((s): s is Student => !!s)
            .sort(byName),
        })));
        setStatus('idle');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [block, blockCourses, year, coursesLoaded]);

  // Browsers use the page title as the default "Save as PDF" file name.
  useEffect(() => {
    document.title = block ? `Attendance - Block ${block} - ${date}` : 'Attendance sheet';
  }, [block, date]);

  const rooms = Array.from(new Set(sections.map(s => s.course.room).filter(Boolean)));
  const total = sections.reduce((n, s) => n + s.students.length, 0);

  const cell = { border: `1px solid #999`, padding: '5px 8px', fontSize: 13 } as const;
  const head = { ...cell, background: RCS.lightBlue, color: RCS.deepNavy, fontWeight: 800, textAlign: 'left' } as const;
  const box = { ...cell, width: 34, textAlign: 'center' } as const;

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: 'system-ui, sans-serif' }} className="attendance-root">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .attendance-root { background: #fff !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; max-width: none !important; }
          .section { break-inside: avoid; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
          @page { margin: 12mm; }
        }
      `}</style>

      <div className="no-print">
        <Banner active="courses" />
        <div style={{ background: RCS.midBlue, padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <a href="/courses" style={{ color: RCS.white, fontSize: 13, fontWeight: 800 }}>← Courses</a>
          <h1 style={{ color: RCS.white, margin: 0, fontSize: 18, marginRight: 'auto' }}>TOC attendance sheet</h1>
          <select value={year} onChange={e => setParam('year', e.target.value)} style={{ padding: 8, border: `1px solid ${RCS.gold}`, borderRadius: 8, background: RCS.paleGold, color: RCS.deepNavy, fontWeight: 900 }}>
            {Array.from(new Set([...KNOWN_YEARS, year])).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={block} onChange={e => setParam('block', e.target.value)} style={{ padding: 8, borderRadius: 8, fontWeight: 800 }}>
            <option value="">Choose a block…</option>
            {blocks.map(b => <option key={b} value={b}>Block {b}</option>)}
          </select>
          <input type="date" value={date} onChange={e => setParam('date', e.target.value)} style={{ padding: 7, borderRadius: 8 }} />
          <label style={{ color: RCS.white, fontSize: 13, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={onlyRunning} onChange={e => setParam('all', e.target.checked ? '' : '1')} />
            Only courses running this date
          </label>
          <button
            onClick={() => window.print()}
            disabled={!block || status !== 'idle'}
            style={{ background: RCS.gold, border: `1px solid ${RCS.gold}`, color: RCS.deepNavy, borderRadius: 10, fontWeight: 900, padding: '8px 16px', cursor: 'pointer', opacity: !block || status !== 'idle' ? 0.5 : 1 }}
          >
            Print / Save as PDF
          </button>
        </div>
        <div style={{ padding: '10px 24px', fontSize: 13, color: RCS.deepNavy, background: RCS.paleGold, borderBottom: `1px solid ${RCS.gold}` }}>
          This sheet contains student names. Check it before sending, send it only from your RCS account to the TOC&apos;s school address, and ask for printed copies to be shredded.
        </div>
      </div>

      {block && onlyRunning && coursesLoaded && !dateQuarter && (
        <div className="no-print" style={{ padding: '10px 24px', fontSize: 13, color: '#8a4b00', background: '#fff4e0', borderBottom: '1px solid #f0c080' }}>
          No school quarter in {year} covers {formatDate(date)}, so every course in Block {block} is shown. Check the date, or set quarter dates on the School Quarters page.
        </div>
      )}
      {block && filtering && hiddenCount > 0 && (
        <div className="no-print" style={{ padding: '10px 24px', fontSize: 13, color: RCS.deepNavy }}>
          Showing {dateQuarter} courses only. {hiddenCount} other {hiddenCount === 1 ? 'course runs' : 'courses run'} in Block {block} in other quarters.
        </div>
      )}

      {status === 'error' && <div className="no-print" style={{ padding: 24, color: 'crimson' }}>{error}</div>}
      {!block && status !== 'error' && <div className="no-print" style={{ padding: 24, color: RCS.textDark }}>Choose a block to build its sheet.</div>}
      {block && status === 'loading' && <div className="no-print" style={{ padding: 24 }}>Loading…</div>}

      {block && status === 'idle' && (
        <div className="sheet" style={{ maxWidth: 820, margin: '24px auto', background: RCS.white, padding: 32, boxShadow: '0 1px 6px rgba(0,0,0,0.15)', color: RCS.textDark }}>
          <div style={{ borderBottom: `3px solid ${RCS.deepNavy}`, paddingBottom: 10, marginBottom: 14 }}>
            <div style={{ color: RCS.midBlue, fontWeight: 900, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>Richmond Christian School · Confidential</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: '4px 0 0', color: RCS.deepNavy, fontSize: 22 }}>Attendance · Block {block}</h2>
              <div style={{ fontWeight: 800 }}>{formatDate(date)}</div>
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {rooms.length ? `Room ${rooms.join(', ')} · ` : ''}{sections.length} {sections.length === 1 ? 'class' : 'classes'} · {total} students · {filtering ? `${dateQuarter} · ` : ''}{year}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 13, marginBottom: 16 }}>
            <div>TOC name: ______________________________</div>
            <div>Mark each student <b>P</b> (present), <b>A</b> (absent) or <b>L</b> (late).</div>
          </div>

          {sections.length === 0 && <div>No courses in this block for {year}{filtering ? ` in ${dateQuarter}` : ''}.</div>}

          {sections.map(({ course, students }) => (
            <div key={course.id} className="section" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, borderBottom: `2px solid ${RCS.gold}`, marginBottom: 6, paddingBottom: 3 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: RCS.deepNavy }}>{course.name}</h3>
                <div style={{ fontSize: 12, color: RCS.midBlue }}>
                  {[
                    course.room ? `Room ${course.room}` : null,
                    course.quarters?.length ? `Quarters ${course.quarters.join(', ')}` : null,
                    `${students.length} students`,
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
              {students.length === 0 ? (
                <div style={{ fontSize: 13, fontStyle: 'italic' }}>No students enrolled.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...head, width: 28 }}>#</th>
                      <th style={head}>Last name</th>
                      <th style={head}>First name</th>
                      <th style={{ ...head, width: 36 }}>Gr.</th>
                      <th style={{ ...head, ...box }}>P</th>
                      <th style={{ ...head, ...box }}>A</th>
                      <th style={{ ...head, ...box }}>L</th>
                      <th style={{ ...head, width: '28%' }}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, i) => (
                      <tr key={s.id}>
                        <td style={{ ...cell, color: '#666' }}>{i + 1}</td>
                        <td style={cell}>{s.last_name}</td>
                        <td style={cell}>{s.first_name}</td>
                        <td style={cell}>{s.grade_year ?? ''}</td>
                        <td style={box}></td>
                        <td style={box}></td>
                        <td style={box}></td>
                        <td style={cell}></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}

          <div style={{ fontSize: 11, color: '#555', borderTop: '1px solid #ccc', paddingTop: 8, marginTop: 8 }}>
            Please return this sheet to the office or the classroom teacher at the end of the day. Contains student names: do not post, share or photograph beyond returning it. Shred when done.
          </div>
        </div>
      )}
    </div>
  );
}
