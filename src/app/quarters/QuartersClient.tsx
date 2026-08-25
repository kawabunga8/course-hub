'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import Banner from '@/components/Banner';
import { currentSchoolYear } from '@/lib/school-year';

type QuarterRow = { id: number; label: string; start_date: string; end_date: string; school_year: string };

const QUARTER_LABELS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;

/** "2026-27" shifted by whole years: -1 gives "2025-26". */
function shiftYearLabel(label: string, by: number): string {
  const start = Number(label.slice(0, 4));
  if (!Number.isFinite(start)) return label;
  const next = start + by;
  return `${next}-${String(next + 1).slice(2)}`;
}

/** "2025-09-02" a year on is "2026-09-02". Close enough to edit from. */
function shiftIsoYear(iso: string, by: number): string {
  const [y, rest] = [iso.slice(0, 4), iso.slice(4)];
  return `${Number(y) + by}${rest}`;
}

/** Last, current and next, so a new year is selectable without editing code. */
function selectableYears(): string[] {
  const now = currentSchoolYear();
  return [shiftYearLabel(now, -1), now, shiftYearLabel(now, 1)];
}

const RCS = {
  deepNavy: '#1F4E79', midBlue: '#2E75B6', lightBlue: '#D6E4F0',
  gold: '#C9A84C', paleGold: '#FDF3DC', white: '#FFFFFF', textDark: '#1A1A1A',
} as const;

export default function QuartersClient() {
  const [quarters, setQuarters] = useState<QuarterRow[]>([]);
  const [schoolYear, setSchoolYear] = useState<string>(currentSchoolYear);
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setStatus('loading');
    setError(null);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('school_quarters')
      .select('id,label,start_date,end_date,school_year')
      .eq('school_year', schoolYear)
      .order('label');
    if (error) { setError(error.message); setStatus('error'); return; }
    setQuarters((data ?? []) as QuarterRow[]);
    setStatus('idle');
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [schoolYear]);

  // A year's quarters have to exist before they can be edited, and save() below
  // can only update rows that already exist. Without this there is no way to roll
  // a year over from the app at all: the page correctly reports "no quarters set"
  // and offers nothing to do about it.
  async function createYear() {
    setStatus('saving');
    setError(null);
    const supabase = getSupabaseClient();

    // A school calendar repeats closely, so last year's dates shifted on by one
    // are a better starting point than blanks. A draft to correct, not an answer:
    // weekdays drift and holidays move.
    const prevYear = shiftYearLabel(schoolYear, -1);
    const { data: prev, error: prevErr } = await supabase
      .from('school_quarters')
      .select('label,start_date,end_date')
      .eq('school_year', prevYear);
    if (prevErr) { setError(prevErr.message); setStatus('error'); return; }

    // id is an int key shared across years, so take the next free one rather than
    // assuming the column has a default.
    const { data: top, error: topErr } = await supabase
      .from('school_quarters')
      .select('id')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (topErr) { setError(topErr.message); setStatus('error'); return; }

    let nextId = Number(top?.id ?? 0) + 1;
    const startYear = Number(schoolYear.slice(0, 4));

    const rows = QUARTER_LABELS.map((label, i) => {
      const source = (prev ?? []).find((q) => q.label === label);
      // Fallback when there is no prior year: four blocks across the school year,
      // obviously placeholder, meant to be corrected right here.
      const fallbackStart = [`${startYear}-09-01`, `${startYear}-11-01`, `${startYear + 1}-02-01`, `${startYear + 1}-04-15`][i];
      const fallbackEnd = [`${startYear}-10-31`, `${startYear + 1}-01-31`, `${startYear + 1}-04-14`, `${startYear + 1}-06-30`][i];
      return {
        id: nextId++,
        label,
        school_year: schoolYear,
        start_date: source ? shiftIsoYear(source.start_date, 1) : fallbackStart,
        end_date: source ? shiftIsoYear(source.end_date, 1) : fallbackEnd,
      };
    });

    const { error } = await supabase.from('school_quarters').insert(rows);
    if (error) { setError(error.message); setStatus('error'); return; }
    await load();
  }

  async function save() {
    setStatus('saving');
    setError(null);
    const supabase = getSupabaseClient();
    for (const q of quarters) {
      const { error } = await supabase.from('school_quarters').update({ start_date: q.start_date, end_date: q.end_date }).eq('id', q.id);
      if (error) { setError(error.message); setStatus('error'); return; }
    }
    setStatus('idle');
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: 'system-ui, sans-serif' }}>
      <Banner active="quarters" />
      <div style={{ padding: 24, color: RCS.textDark }}>
      <h1 style={{ color: RCS.deepNavy, marginTop: 0 }}>School Quarters</h1>
      <p style={{ fontSize: 13, color: '#555', marginBottom: 16 }}>
        Set the start/end dates for Q1–Q4. TOC-Dayplans, Report Card Tool, and Kawahoot all read these dates
        to know which courses/classes are active on a given day — change them here once, applies everywhere.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: RCS.deepNavy }}>School year</span>
        <select
          value={schoolYear}
          onChange={e => setSchoolYear(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${RCS.deepNavy}`,
                   background: RCS.white, color: RCS.textDark, fontWeight: 700 }}>
          {selectableYears().map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {status === 'loading' && <div>Loading…</div>}
      {status === 'idle' && quarters.length === 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: '#7F1D1D', marginBottom: 8 }}>
            No quarters set for {schoolYear} yet. Every app that asks which course runs
            on a date falls back to an earlier year until these exist.
          </div>
          <button
            type="button"
            onClick={createYear}
            style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${RCS.deepNavy}`,
                     background: RCS.deepNavy, color: RCS.white, fontWeight: 800, cursor: 'pointer' }}>
            Create Q1–Q4 for {schoolYear}
          </button>
          <div style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
            Starts from {shiftYearLabel(schoolYear, -1)}&rsquo;s dates shifted on a year.
            Check every one before relying on them.
          </div>
        </div>
      )}
      {error && <div style={{ color: 'crimson', marginBottom: 12 }}>{error}</div>}

      <div style={{ border: `1px solid ${RCS.deepNavy}`, borderRadius: 12, padding: 16, background: RCS.paleGold, display: 'grid', gap: 12, maxWidth: 480 }}>
        {quarters.map((q, i) => (
          <div key={q.id} style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ width: 32, fontWeight: 900, color: RCS.midBlue }}>{q.label}</div>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: RCS.midBlue }}>Start</span>
              <input
                type="date"
                value={q.start_date}
                onChange={(e) => setQuarters((prev) => prev.map((x, idx) => (idx === i ? { ...x, start_date: e.target.value } : x)))}
                style={{ padding: 6, border: `1px solid ${RCS.deepNavy}`, borderRadius: 6 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: RCS.midBlue }}>End</span>
              <input
                type="date"
                value={q.end_date}
                onChange={(e) => setQuarters((prev) => prev.map((x, idx) => (idx === i ? { ...x, end_date: e.target.value } : x)))}
                style={{ padding: 6, border: `1px solid ${RCS.deepNavy}`, borderRadius: 6 }}
              />
            </label>
          </div>
        ))}
        <button
          onClick={save}
          disabled={status === 'saving' || status === 'loading'}
          style={{ background: RCS.deepNavy, color: RCS.white, border: `1px solid ${RCS.gold}`, borderRadius: 10, fontWeight: 900, padding: '8px 16px', cursor: 'pointer', justifySelf: 'start' }}
        >
          {status === 'saving' ? 'Saving…' : 'Save quarters'}
        </button>
      </div>
      </div>
    </div>
  );
}
