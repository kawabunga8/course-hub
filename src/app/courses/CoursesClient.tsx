'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import Banner from '@/components/Banner';

type Course = {
  id: string;
  name: string;
  block: string | null;
  grade_years: number[];
  school_year: string | null;
  type: 'academic' | 'chapel' | 'flex' | 'lunch' | 'cle';
  room: string | null;
  sort_order: number | null;
  quarters: string[] | null;
  superseded_by: string | null;
};

const KNOWN_YEARS = ['2025-26', '2026-27'];
const TYPES: Course['type'][] = ['academic', 'chapel', 'flex', 'lunch', 'cle'];

function currentSchoolYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

const RCS = {
  deepNavy: '#1F4E79', midBlue: '#2E75B6', lightBlue: '#D6E4F0',
  gold: '#C9A84C', paleGold: '#FDF3DC', white: '#FFFFFF', textDark: '#1A1A1A',
} as const;

type CourseForm = {
  name: string;
  block: string;
  grade_years: string;
  type: Course['type'];
  room: string;
  sort_order: string;
  quarters: string;
};

const emptyForm: CourseForm = { name: '', block: '', grade_years: '', type: 'academic', room: '', sort_order: '', quarters: '' };

function parseGradeYears(input: string): number[] {
  return input.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
}

function parseQuarters(input: string): string[] | null {
  const list = input.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

export default function CoursesClient() {
  const [selectedYear, setSelectedYear] = useState(currentSchoolYear);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'idle' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<CourseForm>(emptyForm);
  const [addStatus, setAddStatus] = useState<'idle' | 'working' | 'error'>('idle');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CourseForm>(emptyForm);
  const [editStatus, setEditStatus] = useState<'idle' | 'working' | 'error'>('idle');

  const load = useCallback(async () => {
    setLoadStatus('loading');
    setLoadError(null);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('current_courses', { p_school_year: selectedYear });
    if (error) {
      setLoadError(error.message);
      setLoadStatus('error');
      return;
    }
    // sort_order already encodes block position and, within a block, the quarter a
    // course runs in — so sorting by block first would undo both (CLE would land
    // between C and D, and Band 9 (Q3/Q4) ahead of ICT 9 (Q1)).
    const rows = ((data ?? []) as Course[]).sort((a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)
    );
    setCourses(rows);
    setLoadStatus('idle');
  }, [selectedYear]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, Course[]>();
    for (const c of courses) {
      const key = c.block ?? '(no block)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries());
  }, [courses]);

  async function handleAdd() {
    if (!addForm.name.trim()) return;
    setAddStatus('working');
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('courses').insert({
      name: addForm.name.trim(),
      block: addForm.block.trim() || null,
      grade_years: parseGradeYears(addForm.grade_years),
      type: addForm.type,
      room: addForm.room.trim() || null,
      sort_order: addForm.sort_order ? Number(addForm.sort_order) : null,
      quarters: parseQuarters(addForm.quarters),
      school_year: null,
    });
    if (error) { setAddStatus('error'); return; }
    setAddForm(emptyForm);
    setShowAdd(false);
    setAddStatus('idle');
    load();
  }

  function startEdit(c: Course) {
    setEditingId(c.id);
    setEditForm({
      name: c.name,
      block: c.block ?? '',
      grade_years: c.grade_years.join(', '),
      type: c.type,
      room: c.room ?? '',
      sort_order: c.sort_order != null ? String(c.sort_order) : '',
      quarters: (c.quarters ?? []).join(', '),
    });
  }

  // Editing never rewrites a row in place: it creates a new versioned row scoped to
  // the currently selected school year and marks the old row as superseded — so
  // anything that already references the old row (rosters, day plans) keeps its history.
  async function saveEdit(c: Course) {
    if (!editForm.name.trim()) return;
    setEditStatus('working');
    const supabase = getSupabaseClient();

    const { data: newRow, error: insertErr } = await supabase
      .from('courses')
      .insert({
        name: editForm.name.trim(),
        block: editForm.block.trim() || null,
        grade_years: parseGradeYears(editForm.grade_years),
        type: editForm.type,
        room: editForm.room.trim() || null,
        sort_order: editForm.sort_order ? Number(editForm.sort_order) : null,
        quarters: parseQuarters(editForm.quarters),
        school_year: selectedYear,
      })
      .select('id')
      .single();
    if (insertErr || !newRow) { setEditStatus('error'); return; }

    const { error: supersedeErr } = await supabase
      .from('courses')
      .update({ superseded_by: newRow.id, superseded_at: new Date().toISOString() })
      .eq('id', c.id);
    if (supersedeErr) { setEditStatus('error'); return; }

    setEditingId(null);
    setEditStatus('idle');
    load();
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: 'system-ui, sans-serif' }}>
      <Banner active="courses" />

      <div style={{ background: RCS.midBlue, padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ color: RCS.white, margin: 0, fontSize: 18 }}>Courses</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} style={{ padding: 8, border: `1px solid ${RCS.gold}`, borderRadius: 8, background: RCS.paleGold, color: RCS.deepNavy, fontWeight: 900 }}>
            {KNOWN_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            onClick={() => setShowAdd((v) => !v)}
            style={{ background: RCS.gold, border: `1px solid ${RCS.gold}`, color: RCS.deepNavy, borderRadius: 10, fontWeight: 900, padding: '8px 16px', cursor: 'pointer' }}
          >
            + Add Course
          </button>
        </div>
      </div>

      <div style={{ padding: 24, color: RCS.textDark }}>

      {showAdd && (
        <div style={{ border: `1px solid ${RCS.deepNavy}`, borderRadius: 12, padding: 16, marginBottom: 20, background: RCS.paleGold }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
            <input placeholder="Name" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} style={{ padding: 8 }} />
            <input placeholder="Block" value={addForm.block} onChange={(e) => setAddForm({ ...addForm, block: e.target.value })} style={{ padding: 8 }} />
            <input placeholder="Grade years (e.g. 11)" value={addForm.grade_years} onChange={(e) => setAddForm({ ...addForm, grade_years: e.target.value })} style={{ padding: 8 }} />
            <select value={addForm.type} onChange={(e) => setAddForm({ ...addForm, type: e.target.value as Course['type'] })} style={{ padding: 8 }}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Room" value={addForm.room} onChange={(e) => setAddForm({ ...addForm, room: e.target.value })} style={{ padding: 8 }} />
            <input placeholder="Sort order" value={addForm.sort_order} onChange={(e) => setAddForm({ ...addForm, sort_order: e.target.value })} style={{ padding: 8 }} />
            <input placeholder="Quarters (e.g. Q1, Q2)" value={addForm.quarters} onChange={(e) => setAddForm({ ...addForm, quarters: e.target.value })} style={{ padding: 8 }} />
          </div>
          <button onClick={handleAdd} disabled={addStatus === 'working'} style={{ background: RCS.deepNavy, color: RCS.white, border: `1px solid ${RCS.gold}`, borderRadius: 10, padding: '6px 14px', cursor: 'pointer' }}>
            {addStatus === 'working' ? 'Saving…' : 'Save'}
          </button>
          {addStatus === 'error' && <span style={{ color: 'crimson', marginLeft: 8 }}>Failed to save.</span>}
        </div>
      )}

      {loadStatus === 'loading' && <div>Loading…</div>}
      {loadStatus === 'error' && <div style={{ color: 'crimson' }}>{loadError}</div>}

      {grouped.map(([block, rows]) => (
        <div key={block} style={{ marginBottom: 24 }}>
          <div style={{ background: RCS.deepNavy, color: RCS.white, borderBottom: `3px solid ${RCS.gold}`, fontWeight: 900, padding: '8px 12px', borderRadius: '8px 8px 0 0' }}>
            Block {block}
          </div>
          <div style={{ border: `1px solid ${RCS.deepNavy}`, borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
            {rows.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: `1px solid ${RCS.lightBlue}`, gap: 10, flexWrap: 'wrap' }}>
                {editingId === c.id ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, flex: 1 }}>
                      <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} style={{ padding: 6 }} />
                      <input value={editForm.block} onChange={(e) => setEditForm({ ...editForm, block: e.target.value })} style={{ padding: 6 }} />
                      <input value={editForm.grade_years} onChange={(e) => setEditForm({ ...editForm, grade_years: e.target.value })} style={{ padding: 6 }} />
                      <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value as Course['type'] })} style={{ padding: 6 }}>
                        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input value={editForm.room} onChange={(e) => setEditForm({ ...editForm, room: e.target.value })} placeholder="Room" style={{ padding: 6 }} />
                      <input value={editForm.quarters} onChange={(e) => setEditForm({ ...editForm, quarters: e.target.value })} placeholder="Quarters" style={{ padding: 6 }} />
                    </div>
                    <button onClick={() => saveEdit(c)} disabled={editStatus === 'working'} style={{ background: RCS.deepNavy, color: RCS.white, border: `1px solid ${RCS.gold}`, borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>
                      {editStatus === 'working' ? 'Saving…' : `Save as ${selectedYear} version`}
                    </button>
                    <button onClick={() => setEditingId(null)} style={{ background: 'transparent', border: `1px solid ${RCS.deepNavy}`, color: RCS.deepNavy, borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <span>{c.name}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, color: RCS.midBlue }}>
                        {c.type !== 'academic' ? `${c.type} · ` : ''}
                        {c.grade_years.length ? `Gr. ${c.grade_years.join(', ')} · ` : ''}
                        {c.school_year ?? 'all years'}
                      </span>
                    </div>
                    <button onClick={() => startEdit(c)} style={{ background: 'transparent', border: `1px solid ${RCS.gold}`, color: RCS.deepNavy, borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>Edit</button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}
