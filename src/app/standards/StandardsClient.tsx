'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import Banner from '@/components/Banner';

type Standard = {
  id: string;
  subject: string;
  standard_key: string;
  standard_title: string;
  sort_order: number | null;
  school_year: string | null;
  superseded_by: string | null;
};

type Rubric = {
  id: string;
  learning_standard_id: string;
  grade: number;
  level: 'emerging' | 'developing' | 'proficient' | 'extending';
  original_text: string;
  edited_text: string | null;
};

const KNOWN_YEARS = ['2025-26', '2026-27'];
const GRADES = [9, 10, 11, 12];
const LEVELS: Rubric['level'][] = ['emerging', 'developing', 'proficient', 'extending'];

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

export default function StandardsClient() {
  const [selectedYear, setSelectedYear] = useState(currentSchoolYear);
  const [standards, setStandards] = useState<Standard[]>([]);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'idle' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ subject: '', standard_key: '', standard_title: '', sort_order: '' });
  const [addStatus, setAddStatus] = useState<'idle' | 'working' | 'error'>('idle');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editStatus, setEditStatus] = useState<'idle' | 'working' | 'error'>('idle');

  const [rubricFor, setRubricFor] = useState<Standard | null>(null);
  const [rubricRows, setRubricRows] = useState<Rubric[]>([]);
  const [rubricStatus, setRubricStatus] = useState<'idle' | 'loading' | 'saving'>('idle');

  const load = useCallback(async () => {
    setLoadStatus('loading');
    setLoadError(null);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('current_learning_standards', { p_school_year: selectedYear });
    if (error) {
      setLoadError(error.message);
      setLoadStatus('error');
      return;
    }
    const rows = ((data ?? []) as Standard[]).sort((a, b) =>
      a.subject.localeCompare(b.subject) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.standard_title.localeCompare(b.standard_title)
    );
    setStandards(rows);
    setLoadStatus('idle');
  }, [selectedYear]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, Standard[]>();
    for (const s of standards) {
      if (!map.has(s.subject)) map.set(s.subject, []);
      map.get(s.subject)!.push(s);
    }
    return Array.from(map.entries());
  }, [standards]);

  async function handleAdd() {
    if (!addForm.subject.trim() || !addForm.standard_key.trim() || !addForm.standard_title.trim()) return;
    setAddStatus('working');
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('learning_standards').insert({
      subject: addForm.subject.trim(),
      standard_key: addForm.standard_key.trim(),
      standard_title: addForm.standard_title.trim(),
      sort_order: addForm.sort_order ? Number(addForm.sort_order) : null,
      school_year: null,
    });
    if (error) { setAddStatus('error'); return; }
    setAddForm({ subject: '', standard_key: '', standard_title: '', sort_order: '' });
    setShowAdd(false);
    setAddStatus('idle');
    load();
  }

  function startEdit(s: Standard) {
    setEditingId(s.id);
    setEditTitle(s.standard_title);
  }

  // Editing a standard never rewrites the row in place: it creates a new versioned
  // row scoped to the currently selected school year, copies that standard's rubric
  // rows as a starting point, and marks the old row as superseded — so anything that
  // already references the old row (day plans, generated comments) keeps its history.
  async function saveEdit(s: Standard) {
    if (!editTitle.trim()) return;
    setEditStatus('working');
    const supabase = getSupabaseClient();

    const { data: newRow, error: insertErr } = await supabase
      .from('learning_standards')
      .insert({
        subject: s.subject,
        standard_key: s.standard_key,
        standard_title: editTitle.trim(),
        sort_order: s.sort_order,
        school_year: selectedYear,
      })
      .select('id')
      .single();
    if (insertErr || !newRow) { setEditStatus('error'); return; }

    const { data: oldRubrics } = await supabase
      .from('learning_standard_rubrics')
      .select('grade,level,original_text,edited_text')
      .eq('learning_standard_id', s.id);
    if (oldRubrics && oldRubrics.length > 0) {
      await supabase.from('learning_standard_rubrics').insert(
        oldRubrics.map((r) => ({ ...r, learning_standard_id: newRow.id }))
      );
    }

    const { error: supersedeErr } = await supabase
      .from('learning_standards')
      .update({ superseded_by: newRow.id, superseded_at: new Date().toISOString() })
      .eq('id', s.id);
    if (supersedeErr) { setEditStatus('error'); return; }

    setEditingId(null);
    setEditStatus('idle');
    load();
  }

  async function openRubric(s: Standard) {
    setRubricFor(s);
    setRubricStatus('loading');
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('learning_standard_rubrics')
      .select('id,learning_standard_id,grade,level,original_text,edited_text')
      .eq('learning_standard_id', s.id);
    const rows = GRADES.flatMap((grade) =>
      LEVELS.map((level) => {
        const existing = (data ?? []).find((r) => r.grade === grade && r.level === level) as Rubric | undefined;
        return existing ?? { id: '', learning_standard_id: s.id, grade, level, original_text: '', edited_text: null };
      })
    );
    setRubricRows(rows);
    setRubricStatus('idle');
  }

  async function saveRubricRow(row: Rubric, text: string) {
    setRubricStatus('saving');
    const supabase = getSupabaseClient();
    if (row.id) {
      await supabase.from('learning_standard_rubrics').update({ edited_text: text }).eq('id', row.id);
    } else {
      await supabase.from('learning_standard_rubrics').insert({
        learning_standard_id: row.learning_standard_id,
        grade: row.grade,
        level: row.level,
        original_text: text,
      });
    }
    if (rubricFor) await openRubric(rubricFor);
    setRubricStatus('idle');
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: 'system-ui, sans-serif' }}>
      <Banner active="standards" />

      <div style={{ background: RCS.midBlue, padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ color: RCS.white, margin: 0, fontSize: 18 }}>Learning Standards</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} style={{ padding: 8, border: `1px solid ${RCS.gold}`, borderRadius: 8, background: RCS.paleGold, color: RCS.deepNavy, fontWeight: 900 }}>
            {KNOWN_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            onClick={() => setShowAdd((v) => !v)}
            style={{ background: RCS.gold, border: `1px solid ${RCS.gold}`, color: RCS.deepNavy, borderRadius: 10, fontWeight: 900, padding: '8px 16px', cursor: 'pointer' }}
          >
            + Add Standard
          </button>
        </div>
      </div>

      <div style={{ padding: 24, color: RCS.textDark }}>

      {showAdd && (
        <div style={{ border: `1px solid ${RCS.deepNavy}`, borderRadius: 12, padding: 16, marginBottom: 20, background: RCS.paleGold }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
            <input placeholder="Subject" value={addForm.subject} onChange={(e) => setAddForm({ ...addForm, subject: e.target.value })} style={{ padding: 8 }} />
            <input placeholder="Standard key" value={addForm.standard_key} onChange={(e) => setAddForm({ ...addForm, standard_key: e.target.value })} style={{ padding: 8 }} />
            <input placeholder="Title" value={addForm.standard_title} onChange={(e) => setAddForm({ ...addForm, standard_title: e.target.value })} style={{ padding: 8 }} />
            <input placeholder="Sort order" value={addForm.sort_order} onChange={(e) => setAddForm({ ...addForm, sort_order: e.target.value })} style={{ padding: 8 }} />
          </div>
          <button onClick={handleAdd} disabled={addStatus === 'working'} style={{ background: RCS.deepNavy, color: RCS.white, border: `1px solid ${RCS.gold}`, borderRadius: 10, padding: '6px 14px', cursor: 'pointer' }}>
            {addStatus === 'working' ? 'Saving…' : 'Save'}
          </button>
          {addStatus === 'error' && <span style={{ color: 'crimson', marginLeft: 8 }}>Failed to save.</span>}
        </div>
      )}

      {loadStatus === 'loading' && <div>Loading…</div>}
      {loadStatus === 'error' && <div style={{ color: 'crimson' }}>{loadError}</div>}

      {grouped.map(([subject, rows]) => (
        <div key={subject} style={{ marginBottom: 24 }}>
          <div style={{ background: RCS.deepNavy, color: RCS.white, borderBottom: `3px solid ${RCS.gold}`, fontWeight: 900, padding: '8px 12px', borderRadius: '8px 8px 0 0' }}>
            {subject}
          </div>
          <div style={{ border: `1px solid ${RCS.deepNavy}`, borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
            {rows.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: `1px solid ${RCS.lightBlue}` }}>
                {editingId === s.id ? (
                  <>
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={{ flex: 1, padding: 6, marginRight: 8 }} />
                    <button onClick={() => saveEdit(s)} disabled={editStatus === 'working'} style={{ background: RCS.deepNavy, color: RCS.white, border: `1px solid ${RCS.gold}`, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', marginRight: 6 }}>
                      {editStatus === 'working' ? 'Saving…' : `Save as ${selectedYear} version`}
                    </button>
                    <button onClick={() => setEditingId(null)} style={{ background: 'transparent', border: `1px solid ${RCS.deepNavy}`, color: RCS.deepNavy, borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <span>{s.standard_title}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, color: RCS.midBlue }}>
                        {s.standard_key} · {s.school_year ?? 'all years'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openRubric(s)} style={{ background: 'transparent', border: `1px solid ${RCS.gold}`, color: RCS.deepNavy, borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>Rubric</button>
                      <button onClick={() => startEdit(s)} style={{ background: 'transparent', border: `1px solid ${RCS.gold}`, color: RCS.deepNavy, borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>Edit</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {rubricFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: RCS.white, borderRadius: 12, border: `1px solid ${RCS.deepNavy}`, padding: 20, width: 600, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ color: RCS.deepNavy, margin: 0 }}>{rubricFor.standard_title}</h3>
              <button onClick={() => setRubricFor(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>✕</button>
            </div>
            {rubricStatus === 'loading' && <div>Loading…</div>}
            {GRADES.map((grade) => (
              <div key={grade} style={{ marginBottom: 12 }}>
                <strong>Grade {grade}</strong>
                {LEVELS.map((level) => {
                  const row = rubricRows.find((r) => r.grade === grade && r.level === level)!;
                  return (
                    <div key={level} style={{ marginTop: 4 }}>
                      <label style={{ fontSize: 12, textTransform: 'capitalize', color: RCS.midBlue }}>{level}</label>
                      <textarea
                        defaultValue={row.edited_text ?? row.original_text}
                        onBlur={(e) => saveRubricRow(row, e.target.value)}
                        style={{ width: '100%', minHeight: 40, padding: 6, border: `1px solid ${RCS.lightBlue}`, borderRadius: 6 }}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
