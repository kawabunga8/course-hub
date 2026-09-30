'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { currentSchoolYear } from '@/lib/school-year';
import {
  loadBlockSections, loadYearCourses, selectBlockCourses,
  type AttendanceCourse as Course, type AttendanceSection as Section, type Quarter,
} from '@/lib/attendance';
import Banner from '@/components/Banner';

// Printable attendance sheet for a TOC: every course that runs in one block,
// each with its enrolled students. Printed or saved as PDF from the browser —
// nothing here is uploaded or shared, and it only shows names and grade, never
// photos, emails, notes or marks. The sheet itself is built in @/lib/attendance,
// which TOC Day Plans also uses through GET /api/attendance.

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
  // The year whose courses are loaded; comparing it with `year` marks a year
  // change as loading without setting state inside the effect.
  const [loadedYear, setLoadedYear] = useState<string | null>(null);
  const coursesLoaded = loadedYear === year;
  const [loadedSections, setSections] = useState<Section[]>([]);
  const [rosterStatus, setStatus] = useState<'loading' | 'idle' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`/courses/attendance?${next.toString()}`);
  }

  // Courses for the year — drives the block picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { courses, quarters } = await loadYearCourses(getSupabaseClient(), year);
        if (cancelled) return;
        setQuarters(quarters);
        setCourses(courses);
        setLoadedYear(year);
      } catch (e) {
        if (cancelled) return;
        setError((e as { message?: string })?.message ?? String(e));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [year]);

  const blocks = useMemo(() => {
    const seen: string[] = [];
    for (const c of courses) if (c.block && !seen.includes(c.block)) seen.push(c.block);
    return seen;
  }, [courses]);

  const { blockCourses, dateQuarter, filtering, hiddenCount } = useMemo(
    () => selectBlockCourses(courses, quarters, block, date, onlyRunning),
    [courses, quarters, block, date, onlyRunning]);

  // With no block chosen, or no courses in it, there's no roster to load.
  const noRoster = coursesLoaded && (!block || !blockCourses.length);
  const sections = noRoster ? [] : loadedSections;
  const status = noRoster && rosterStatus !== 'error' ? 'idle' : rosterStatus;

  // Rosters for every course in the chosen block.
  useEffect(() => {
    if (!coursesLoaded || noRoster) return;
    let cancelled = false;
    (async () => {
      setStatus('loading');
      setError(null);
      try {
        const next = await loadBlockSections(getSupabaseClient(), block, blockCourses, year);
        if (cancelled) return;
        setSections(next);
        setStatus('idle');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [block, blockCourses, year, coursesLoaded, noRoster]);

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
