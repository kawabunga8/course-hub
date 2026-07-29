'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import Banner from '@/components/Banner';

// ── Types ─────────────────────────────────────────────────────────────────────

type Student = {
  id: string;
  first_name: string;
  last_name: string;
  photo_url: string | null;
  grade_year: number | null;
  grade_year_reference: string | null;
  gender: string | null;
  student_number: string | null;
  school_year: string | null;
  email: string | null;
};

type ClassRow = { id: string; name: string; block_label: string | null; sort_order: number | null };
type EnrollmentRow = { class_id: string; school_year: string | null };
type NoteRow = { id: string; note: string; created_at: string; updated_at: string };
type MarkRow = { id: string; subject: string; mark: string; quarter: number | null; class_id: string | null; note: string | null; created_at: string };

type Panel = 'info' | 'classes' | 'notes' | 'marks';

function currentSchoolYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

function derivedGrade(gradeYear: number | null, reference: string | null, selectedYear: string): number | null {
  if (!gradeYear || !reference) return gradeYear;
  const refStart = parseInt(reference.split('-')[0]!);
  const selStart = parseInt(selectedYear.split('-')[0]!);
  const grade = gradeYear + (selStart - refStart);
  return grade >= 9 && grade <= 12 ? grade : null;
}

const KNOWN_YEARS = ['2025-26', '2026-27'];
const GRADE_YEARS = [9, 10, 11, 12];
const GENDERS = ['male', 'female', 'non-binary'];
const STUDENT_PHOTOS_BUCKET = 'Student Photos';

// Same convention used across the other RCS apps: red = not set, blue = male, pink = female, green = non-binary.
const GENDER_DOT: Record<string, string> = { male: '#3d6bc4', female: '#d4537e', 'non-binary': '#3b6d11' };
function genderDotColor(gender: string | null): string {
  return gender ? (GENDER_DOT[gender] ?? '#999') : '#d4302f';
}

// ── RCS colours ───────────────────────────────────────────────────────────────

const RCS = {
  deepNavy: '#1F4E79', midBlue: '#2E75B6', lightBlue: '#D6E4F0',
  gold: '#C9A84C', paleGold: '#FDF3DC', white: '#FFFFFF', textDark: '#1A1A1A',
} as const;

// ── Component ─────────────────────────────────────────────────────────────────

export default function StudentsClient() {
  const [selectedYear, setSelectedYear] = useState(currentSchoolYear);

  // ── Global data ────────────────────────────────────────────────────────────
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'idle' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Search / filter ────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterGrade, setFilterGrade] = useState<number | 'all'>('all');
  const [view, setView] = useState<'all' | 'grade' | 'block' | 'gender'>('all');

  // ── Directory-wide data (for thumbnails + "By Block" grouping) ────────────
  const [allEnrollments, setAllEnrollments] = useState<{ student_id: string; class_id: string; school_year: string | null }[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  // ── Selected student ───────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<Panel>('info');

  // ── Add student form ───────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ first_name: '', last_name: '', grade_year: '', gender: '', student_number: '', school_year: '', email: '' });
  const [addStatus, setAddStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [addError, setAddError] = useState<string | null>(null);

  // ── Edit student ───────────────────────────────────────────────────────────
  const [editForm, setEditForm] = useState<Partial<Omit<Student, 'id' | 'photo_url'>> | null>(null);
  const [editStatus, setEditStatus] = useState<'idle' | 'working' | 'saved' | 'error'>('idle');
  const [editError, setEditError] = useState<string | null>(null);

  // ── Photo ──────────────────────────────────────────────────────────────────
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── Class enrollments ──────────────────────────────────────────────────────
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [enrollStatus, setEnrollStatus] = useState<'idle' | 'loading' | 'working' | 'error'>('idle');
  const [enrollError, setEnrollError] = useState<string | null>(null);

  // ── Notes ──────────────────────────────────────────────────────────────────
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [notesStatus, setNotesStatus] = useState<'idle' | 'loading' | 'working'>('idle');
  const [notesError, setNotesError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');

  // ── Marks ──────────────────────────────────────────────────────────────────
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [marksStatus, setMarksStatus] = useState<'idle' | 'loading' | 'working'>('idle');
  const [marksError, setMarksError] = useState<string | null>(null);
  const [showAddMark, setShowAddMark] = useState(false);
  const [markForm, setMarkForm] = useState({ subject: '', mark: '', quarter: '', class_id: '', note: '' });
  const [editingMarkId, setEditingMarkId] = useState<string | null>(null);
  const [editingMarkForm, setEditingMarkForm] = useState({ subject: '', mark: '', quarter: '', class_id: '', note: '' });

  // ── Import / Export ────────────────────────────────────────────────────────
  const [importStatus, setImportStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [importMsg, setImportMsg] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const detailRef = useRef<HTMLDivElement>(null);

  // ── Load all students + classes ────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoadStatus('loading'); setLoadError(null);
    try {
      const sb = getSupabaseClient();
      const [sr, cr, er] = await Promise.all([
        sb.from('students').select('id,first_name,last_name,photo_url,grade_year,grade_year_reference,gender,student_number,school_year,email')
          .order('last_name').order('first_name'),
        sb.from('classes').select('id,name,block_label,sort_order')
          .order('sort_order', { ascending: true, nullsFirst: false }),
        sb.from('enrollments').select('student_id,class_id,school_year'),
      ]);
      if (sr.error) throw sr.error;
      if (cr.error) throw cr.error;
      if (er.error) throw er.error;
      setStudents((sr.data ?? []) as Student[]);
      setClasses((cr.data ?? []) as ClassRow[]);
      setAllEnrollments((er.data ?? []) as { student_id: string; class_id: string; school_year: string | null }[]);
      setLoadStatus('idle');
    } catch (e: any) { setLoadStatus('error'); setLoadError(humanizeError(e)); }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Bulk-fetch signed photo URLs for the whole directory (thumbnails in the list) ──
  useEffect(() => {
    const sb = getSupabaseClient();
    const paths = students.map(s => s.photo_url).filter((p): p is string => !!p && !photoUrls[p]);
    if (paths.length === 0) return;
    void sb.storage.from(STUDENT_PHOTOS_BUCKET).createSignedUrls(paths, 3600).then(({ data }) => {
      if (!data) return;
      setPhotoUrls(prev => {
        const next = { ...prev };
        for (const row of data) if (row.signedUrl && !row.error) next[row.path ?? ''] = row.signedUrl;
        return next;
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students]);

  // ── When selected student changes ──────────────────────────────────────────

  useEffect(() => {
    if (!selectedId) { setEditForm(null); return; }
    const s = students.find(s => s.id === selectedId);
    if (!s) return;
    setEditForm({ first_name: s.first_name, last_name: s.last_name, grade_year: s.grade_year, gender: s.gender, student_number: s.student_number, school_year: s.school_year, email: s.email });
    setEditStatus('idle'); setEditError(null);
    setSignedUrl(null); setUploadStatus('idle'); setUploadError(null);
    setEnrollments([]); setNotes([]); setMarks([]);
    setActivePanel('info');
    void loadStudentDetail(selectedId, s.photo_url);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function loadStudentDetail(id: string, photo_url: string | null) {
    const sb = getSupabaseClient();

    // Photo signed URL
    if (photo_url) {
      const { data } = await sb.storage.from(STUDENT_PHOTOS_BUCKET).createSignedUrl(photo_url, 3600);
      if (data?.signedUrl) setSignedUrl(data.signedUrl);
    }

    // Enrollments
    setEnrollStatus('loading');
    const { data: enData, error: enErr } = await sb.from('enrollments').select('class_id,school_year').eq('student_id', id);
    if (!enErr) setEnrollments((enData ?? []) as EnrollmentRow[]);
    setEnrollStatus('idle');

    // Notes
    setNotesStatus('loading');
    const { data: notesData } = await sb.from('student_notes').select('*').eq('student_id', id).order('created_at', { ascending: false });
    setNotes((notesData ?? []) as NoteRow[]);
    setNotesStatus('idle');

    // Marks
    setMarksStatus('loading');
    const { data: marksData } = await sb.from('student_marks').select('*').eq('student_id', id).order('created_at', { ascending: false });
    setMarks((marksData ?? []) as MarkRow[]);
    setMarksStatus('idle');
  }

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter(s => {
      if (derivedGrade(s.grade_year, s.grade_year_reference, selectedYear) === null) return false;
      if (filterGrade !== 'all' && derivedGrade(s.grade_year, s.grade_year_reference, selectedYear) !== filterGrade) return false;
      if (!q) return true;
      return s.first_name.toLowerCase().includes(q) ||
        s.last_name.toLowerCase().includes(q) ||
        (s.student_number ?? '').toLowerCase().includes(q);
    });
  }, [students, search, filterGrade, selectedYear]);

  const selectedStudent = useMemo(() => students.find(s => s.id === selectedId) ?? null, [students, selectedId]);

  function enrolledClassIds(studentId: string): string[] {
    return allEnrollments
      .filter(e => e.student_id === studentId && (e.school_year == null || e.school_year === selectedYear))
      .map(e => e.class_id);
  }

  // ── Grouped sections for the "By Grade / By Block / By Gender" views ──────
  const groupedSections = useMemo(() => {
    if (view === 'grade') {
      return GRADE_YEARS.map(g => ({
        key: `grade-${g}`, label: `Grade ${g}`,
        students: filtered.filter(s => derivedGrade(s.grade_year, s.grade_year_reference, selectedYear) === g),
      })).filter(sec => sec.students.length > 0);
    }
    if (view === 'block') {
      return classes.map(c => ({
        key: `block-${c.id}`, label: (c.block_label ? `Block ${c.block_label} — ` : '') + c.name,
        students: filtered.filter(s => enrolledClassIds(s.id).includes(c.id)),
      })).filter(sec => sec.students.length > 0);
    }
    if (view === 'gender') {
      return [
        { key: 'gender-male', label: 'Male', students: filtered.filter(s => s.gender === 'male') },
        { key: 'gender-female', label: 'Female', students: filtered.filter(s => s.gender === 'female') },
        { key: 'gender-nonbinary', label: 'Non-binary', students: filtered.filter(s => s.gender === 'non-binary') },
        { key: 'gender-none', label: 'Not set', students: filtered.filter(s => !s.gender) },
      ].filter(sec => sec.students.length > 0);
    }
    return [{ key: 'all', label: 'Directory', students: filtered }];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, filtered, classes, allEnrollments, selectedYear]);

  // ── CRUD: students ─────────────────────────────────────────────────────────

  async function addStudent() {
    if (!addForm.first_name.trim() || !addForm.last_name.trim()) { setAddError('First and last name are required.'); return; }
    setAddStatus('working'); setAddError(null);
    try {
      const sb = getSupabaseClient();
      const { data, error } = await sb.from('students').insert({
        first_name: addForm.first_name.trim(), last_name: addForm.last_name.trim(),
        grade_year: addForm.grade_year ? parseInt(addForm.grade_year) : null,
        grade_year_reference: addForm.grade_year ? selectedYear : null,
        gender: addForm.gender || null, student_number: addForm.student_number.trim() || null,
        school_year: addForm.school_year.trim() || null,
        email: addForm.email.trim().toLowerCase() || null,
      }).select().single();
      if (error) throw error;
      setStudents(prev => [...prev, data as Student].sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)));
      setShowAdd(false); setAddForm({ first_name: '', last_name: '', grade_year: '', gender: '', student_number: '', school_year: '', email: '' });
      setAddStatus('idle'); setSelectedId((data as Student).id);
    } catch (e: any) { setAddStatus('error'); setAddError(humanizeError(e)); }
  }

  async function saveEdit() {
    if (!selectedId || !editForm) return;
    if (!editForm.first_name?.trim() || !editForm.last_name?.trim()) { setEditError('First and last name are required.'); return; }
    setEditStatus('working'); setEditError(null);
    try {
      const payload = { first_name: editForm.first_name?.trim() || '', last_name: editForm.last_name?.trim() || '', grade_year: editForm.grade_year ?? null, gender: editForm.gender ?? null, student_number: editForm.student_number?.trim() || null, school_year: editForm.school_year?.trim() || null, email: editForm.email?.trim().toLowerCase() || null };
      const { error } = await getSupabaseClient().from('students').update(payload).eq('id', selectedId);
      if (error) throw error;
      setStudents(prev => prev.map(s => s.id === selectedId ? { ...s, ...payload } : s));
      setEditStatus('saved'); setTimeout(() => setEditStatus('idle'), 2000);
    } catch (e: any) { setEditStatus('error'); setEditError(humanizeError(e)); }
  }

  async function deleteStudent(id: string, name: string) {
    if (!window.confirm(`Delete ${name}? This removes them from all apps and cannot be undone.`)) return;
    try {
      const { error } = await getSupabaseClient().from('students').delete().eq('id', id);
      if (error) throw error;
      setStudents(prev => prev.filter(s => s.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (e: any) { setLoadError(humanizeError(e)); }
  }

  // ── Photo upload ───────────────────────────────────────────────────────────

  async function uploadPhoto(file: File) {
    if (!selectedId) return;
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) { setUploadError('Photo must be under 5 MB.'); return; }
    if (!file.type.startsWith('image/')) { setUploadError('File must be an image (JPEG, PNG, etc.).'); return; }
    setUploadStatus('working'); setUploadError(null);
    try {
      const sb = getSupabaseClient();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `students/${selectedId}.${ext}`;
      const { error: upErr } = await sb.storage.from(STUDENT_PHOTOS_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { error: dbErr } = await sb.from('students').update({ photo_url: path }).eq('id', selectedId);
      if (dbErr) throw dbErr;
      setStudents(prev => prev.map(s => s.id === selectedId ? { ...s, photo_url: path } : s));
      const { data } = await sb.storage.from(STUDENT_PHOTOS_BUCKET).createSignedUrl(path, 3600);
      if (data?.signedUrl) setSignedUrl(data.signedUrl);
      setUploadStatus('idle');
    } catch (e: any) { setUploadStatus('error'); setUploadError(humanizeError(e)); }
  }

  // ── Enrollments ────────────────────────────────────────────────────────────

  async function toggleEnrollment(classId: string, enrolled: boolean) {
    if (!selectedId || !selectedStudent) return;
    setEnrollStatus('working'); setEnrollError(null);
    try {
      const sb = getSupabaseClient();
      const currentSchoolYear = selectedStudent.school_year || null;
      if (enrolled) {
        const { error } = await sb.from('enrollments').delete().eq('student_id', selectedId).eq('class_id', classId).eq('school_year', currentSchoolYear);
        if (error) throw error;
        setEnrollments(prev => prev.filter(e => !(e.class_id === classId && e.school_year === currentSchoolYear)));
      } else {
        const { error } = await sb.from('enrollments').insert({ student_id: selectedId, class_id: classId, school_year: currentSchoolYear });
        if (error) throw error;
        setEnrollments(prev => [...prev, { class_id: classId, school_year: currentSchoolYear }]);
      }
      setEnrollStatus('idle');
    } catch (e: any) { setEnrollStatus('error'); setEnrollError(humanizeError(e)); }
  }

  // ── Notes ──────────────────────────────────────────────────────────────────

  async function addNote() {
    if (!selectedId || !newNote.trim()) return;
    setNotesStatus('working'); setNotesError(null);
    try {
      const { data, error } = await getSupabaseClient().from('student_notes').insert({ student_id: selectedId, note: newNote.trim() }).select().single();
      if (error) throw error;
      setNotes(prev => [data as NoteRow, ...prev]); setNewNote(''); setNotesStatus('idle');
    } catch (e: any) { setNotesError(humanizeError(e)); setNotesStatus('idle'); }
  }

  async function saveNote(id: string) {
    setNotesStatus('working'); setNotesError(null);
    try {
      const { error } = await getSupabaseClient().from('student_notes').update({ note: editingNoteText.trim(), updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      setNotes(prev => prev.map(n => n.id === id ? { ...n, note: editingNoteText.trim() } : n));
      setEditingNoteId(null); setEditingNoteText(''); setNotesStatus('idle');
    } catch (e: any) { setNotesError(humanizeError(e)); setNotesStatus('idle'); }
  }

  async function deleteNote(id: string) {
    if (!window.confirm('Delete this note?')) return;
    const { error } = await getSupabaseClient().from('student_notes').delete().eq('id', id);
    if (error) setNotesError(humanizeError(error));
    else setNotes(prev => prev.filter(n => n.id !== id));
  }

  // ── Marks ──────────────────────────────────────────────────────────────────

  async function addMark() {
    if (!selectedId || !markForm.subject.trim() || !markForm.mark.trim()) return;
    setMarksStatus('working'); setMarksError(null);
    try {
      const { data, error } = await getSupabaseClient().from('student_marks').insert({
        student_id: selectedId, subject: markForm.subject.trim(), mark: markForm.mark.trim(),
        quarter: markForm.quarter ? parseInt(markForm.quarter) : null,
        class_id: markForm.class_id || null, note: markForm.note.trim() || null,
      }).select().single();
      if (error) throw error;
      setMarks(prev => [data as MarkRow, ...prev]);
      setMarkForm({ subject: '', mark: '', quarter: '', class_id: '', note: '' }); setShowAddMark(false); setMarksStatus('idle');
    } catch (e: any) { setMarksError(humanizeError(e)); setMarksStatus('idle'); }
  }

  async function saveMark(id: string) {
    setMarksStatus('working'); setMarksError(null);
    try {
      const { error } = await getSupabaseClient().from('student_marks').update({
        subject: editingMarkForm.subject.trim(),
        mark: editingMarkForm.mark.trim(),
        quarter: editingMarkForm.quarter ? parseInt(editingMarkForm.quarter) : null,
        class_id: editingMarkForm.class_id || null,
        note: editingMarkForm.note.trim() || null,
      }).eq('id', id);
      if (error) throw error;
      setMarks(prev => prev.map(m => m.id === id ? {
        ...m,
        subject: editingMarkForm.subject.trim(),
        mark: editingMarkForm.mark.trim(),
        quarter: editingMarkForm.quarter ? parseInt(editingMarkForm.quarter) : null,
        class_id: editingMarkForm.class_id || null,
        note: editingMarkForm.note.trim() || null,
      } : m));
      setEditingMarkId(null); setEditingMarkForm({ subject: '', mark: '', quarter: '', class_id: '', note: '' }); setMarksStatus('idle');
    } catch (e: any) { setMarksError(humanizeError(e)); setMarksStatus('idle'); }
  }

  async function deleteMark(id: string) {
    if (!window.confirm('Delete this mark?')) return;
    const { error } = await getSupabaseClient().from('student_marks').delete().eq('id', id);
    if (error) setMarksError(humanizeError(error));
    else setMarks(prev => prev.filter(m => m.id !== id));
  }

  // ── Export CSV ─────────────────────────────────────────────────────────────

  function exportCSV() {
    const header = 'first_name,last_name,student_number,grade_year,gender,school_year,email';
    const rows = students.map(s =>
      [s.first_name, s.last_name, s.student_number ?? '', s.grade_year ?? '', s.gender ?? '', s.school_year ?? '', s.email ?? '']
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'students.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Import CSV ─────────────────────────────────────────────────────────────

  async function importCSV(file: File) {
    setImportStatus('working'); setImportMsg('');
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

      const getCol = (row: string[], name: string) => {
        const idx = header.indexOf(name);
        return idx >= 0 ? (row[idx] ?? '').trim() : '';
      };

      const parsed = lines.slice(1).filter(l => l.trim()).map(line => {
        const r = parseCSVLine(line);
        const first = getCol(r, 'first_name') || getCol(r, 'firstname') || getCol(r, 'first name');
        const last = getCol(r, 'last_name') || getCol(r, 'lastname') || getCol(r, 'last name');
        const fullName = getCol(r, 'full_name') || getCol(r, 'fullname') || getCol(r, 'name');
        const finalFirst = (first || (fullName ? fullName.split(' ')[0] : '')).trim();
        const finalLast = (last || (fullName ? fullName.split(' ').slice(1).join(' ') : '')).trim();
        if (!finalFirst || !finalLast) return null;
        const gradeRaw = parseInt(getCol(r, 'grade_year') || getCol(r, 'grade'), 10);
        const grade_year = GRADE_YEARS.includes(gradeRaw) ? gradeRaw : null;
        const email = (getCol(r, 'email') || getCol(r, 'student_email') || getCol(r, 'student email') || '').toLowerCase() || null;
        return {
          first_name: finalFirst, last_name: finalLast,
          student_number: getCol(r, 'student_number') || getCol(r, 'student number') || null,
          grade_year,
          gender: getCol(r, 'gender') || null,
          school_year: getCol(r, 'school_year') || getCol(r, 'school year') || null,
          email,
        };
      }).filter(Boolean) as { first_name: string; last_name: string; student_number: string | null; grade_year: number | null; gender: string | null; school_year: string | null; email: string | null }[];

      if (parsed.length === 0) {
        setImportStatus('error');
        setImportMsg('No valid rows found. CSV must have first_name (or full_name) and last_name columns.');
        return;
      }

      // Fetch all existing students for deduplication
      const sb = getSupabaseClient();
      const { data: existing } = await sb.from('students').select('id,first_name,last_name,student_number,email');
      const existingList = (existing ?? []) as { id: string; first_name: string; last_name: string; student_number: string | null; email: string | null }[];

      const toInsert: typeof parsed = [];
      let updatedCount = 0;

      for (const row of parsed) {
        // Match by email first (most reliable on re-import), then student_number, then name
        const match = existingList.find(e =>
          (row.email && e.email && e.email.toLowerCase() === row.email) ||
          (row.student_number && e.student_number && e.student_number === row.student_number) ||
          (e.last_name.toLowerCase() === row.last_name.toLowerCase() &&
           e.first_name.toLowerCase() === row.first_name.toLowerCase())
        );

        if (match) {
          // Update grade/reference year and email; preserve other fields
          const updates: Record<string, unknown> = {};
          if (row.grade_year) { updates.grade_year = row.grade_year; updates.grade_year_reference = selectedYear; }
          if (row.email && row.email !== match.email) updates.email = row.email;
          if (Object.keys(updates).length > 0) {
            await sb.from('students').update(updates).eq('id', match.id);
            updatedCount++;
          }
        } else {
          toInsert.push(row);
        }
      }

      if (toInsert.length > 0) {
        const { error } = await sb.from('students').insert(
          toInsert.map(r => ({ ...r, grade_year_reference: r.grade_year ? selectedYear : null }))
        );
        if (error) throw error;
      }

      setImportStatus('done');
      setImportMsg(`✓ ${toInsert.length} added, ${updatedCount} updated (grade advanced).`);
      await loadAll();
    } catch (e: any) { setImportStatus('error'); setImportMsg(humanizeError(e)); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const enrolledIds = new Set(enrollments.map(e => e.class_id));
  const currentYear = selectedStudent?.school_year ?? null;
  const currentEnrolledIds = new Set(
    enrollments.filter(e => e.school_year === currentYear).map(e => e.class_id)
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: 'system-ui' }}>

      <Banner active="students" />

      {/* ── Page toolbar ── */}
      <div style={{ background: RCS.midBlue, padding: '10px 24px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* School year selector */}
        <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)}
          style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${RCS.gold}`, background: RCS.paleGold, color: RCS.deepNavy, fontWeight: 900, fontSize: 13, cursor: 'pointer' }}>
          {KNOWN_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {/* Import */}
        <label style={{ ...S.navBtn, cursor: 'pointer' }}>
          {importStatus === 'working' ? 'Importing…' : '⬆ Import CSV'}
          <input ref={importRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) { void importCSV(f); e.currentTarget.value = ''; } }} />
        </label>
        <button onClick={exportCSV} style={S.navBtn}>⬇ Export CSV</button>
        <button onClick={() => { setShowAdd(v => !v); setAddError(null); }} style={S.navBtnGold}>
          {showAdd ? '✕ Cancel' : '+ New Student'}
        </button>
        <button onClick={loadAll} style={S.navBtn}>↻ Refresh</button>
      </div>

      {/* Import feedback */}
      {importMsg && (
        <div style={{ padding: '8px 24px', background: importStatus === 'error' ? '#FEE2E2' : '#dcfce7', color: importStatus === 'error' ? '#7F1D1D' : '#14532d', fontWeight: 800, fontSize: 13 }}>
          {importMsg}
        </div>
      )}

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: 20 }}>

        {loadError && <div style={S.errorBox}>{loadError}</div>}

        {/* ── Add student form ── */}
        {showAdd && (
          <div style={{ ...S.card, borderColor: RCS.gold, background: RCS.paleGold, marginBottom: 16 }}>
            <div style={S.sectionHeader}>New Student</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
              {[
                { label: 'First name *', key: 'first_name', placeholder: 'First' },
                { label: 'Last name *', key: 'last_name', placeholder: 'Last' },
                { label: 'Student #', key: 'student_number', placeholder: 'e.g. 10234' },
              ].map(({ label, key, placeholder }) => (
                <label key={key} style={S.fieldWrap}>
                  <span style={S.label}>{label}</span>
                  <input value={(addForm as any)[key]} onChange={e => setAddForm(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} style={S.input} />
                </label>
              ))}
              <label style={S.fieldWrap}>
                <span style={S.label}>Grade year</span>
                <select value={addForm.grade_year} onChange={e => setAddForm(p => ({ ...p, grade_year: e.target.value }))} style={S.input}>
                  <option value="">— select —</option>
                  {GRADE_YEARS.map(g => <option key={g} value={g}>Grade {g}</option>)}
                </select>
              </label>
              <label style={S.fieldWrap}>
                <span style={S.label}>Gender</span>
                <select value={addForm.gender} onChange={e => setAddForm(p => ({ ...p, gender: e.target.value }))} style={S.input}>
                  <option value="">— not set —</option>
                  {GENDERS.map(g => <option key={g} value={g}>{cap(g)}</option>)}
                </select>
              </label>
              <label style={S.fieldWrap}>
                <span style={S.label}>School year</span>
                <input value={addForm.school_year} onChange={e => setAddForm(p => ({ ...p, school_year: e.target.value }))} placeholder="e.g. 2025-26" style={S.input} />
              </label>
              <label style={S.fieldWrap}>
                <span style={S.label}>Email</span>
                <input value={addForm.email} onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))} placeholder="student@rcseagles.ca" style={S.input} />
              </label>
            </div>
            {addError && <div style={{ ...S.errorBox, marginTop: 10 }}>{addError}</div>}
            <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
              <button onClick={addStudent} disabled={addStatus === 'working'} style={S.primaryBtn}>{addStatus === 'working' ? 'Saving…' : 'Add Student'}</button>
              <button onClick={() => setShowAdd(false)} style={S.secondaryBtn}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Search + filter bar ── */}
        <div style={{ ...S.card, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or student #…"
            style={{ ...S.input, flex: 1, minWidth: 220 }} />
          <select value={filterGrade === 'all' ? 'all' : String(filterGrade)} onChange={e => setFilterGrade(e.target.value === 'all' ? 'all' : parseInt(e.target.value))} style={{ ...S.input, minWidth: 130 }}>
            <option value="all">All grades</option>
            {GRADE_YEARS.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>
          <span style={{ fontSize: 13, opacity: 0.65, whiteSpace: 'nowrap' }}>
            {loadStatus === 'loading' ? 'Loading…' : `${filtered.length} of ${students.length} students`}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'grade', 'block', 'gender'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '6px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                background: view === v ? RCS.deepNavy : '#e8eef4',
                color: view === v ? RCS.white : RCS.textDark,
              }}>
                {v === 'all' ? 'All' : v === 'grade' ? 'By Grade' : v === 'block' ? 'By Block' : 'By Gender'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Two-column layout ── */}
        <div style={{ display: 'grid', gridTemplateColumns: selectedId ? '380px 1fr' : '1fr', gap: 16, alignItems: 'start' }}>

          {/* ── Student list (grouped per the selected view) ── */}
          <div style={{ display: 'grid', gap: 16 }}>
            {loadStatus === 'idle' && filtered.length === 0 && (
              <div style={S.card}><div style={S.muted}>{students.length === 0 ? 'No students yet.' : 'No matches.'}</div></div>
            )}
            {loadStatus === 'loading' && <div style={S.card}><div style={S.muted}>Loading students…</div></div>}
            {loadStatus === 'idle' && groupedSections.map(section => (
              <div key={section.key} style={S.card}>
                <div style={S.sectionHeader}>{section.label}{view !== 'all' ? ` (${section.students.length})` : ''}</div>
                <div style={{ display: 'grid', gap: 5 }}>
                  {section.students.map((s, i) => {
                    const sel = s.id === selectedId;
                    const url = s.photo_url ? photoUrls[s.photo_url] : undefined;
                    return (
                      <div key={s.id} onClick={() => setSelectedId(sel ? null : s.id)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                          padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                          border: sel ? `2px solid ${RCS.gold}` : `1px solid ${i % 2 === 0 ? RCS.deepNavy : '#c8d8e8'}`,
                          background: sel ? RCS.paleGold : (i % 2 === 0 ? RCS.white : '#f5f8fb'),
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                            border: `2px solid ${genderDotColor(s.gender)}`, background: RCS.paleGold,
                            display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 900, color: RCS.deepNavy }}>
                            {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : `${s.first_name[0] ?? ''}${s.last_name[0] ?? ''}`}
                          </div>
                          <div>
                            <div style={{ fontWeight: 900, color: RCS.deepNavy }}>{s.last_name}, {s.first_name}</div>
                            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                              {[s.student_number ? `#${s.student_number}` : null, derivedGrade(s.grade_year, s.grade_year_reference, selectedYear) ? `Gr. ${derivedGrade(s.grade_year, s.grade_year_reference, selectedYear)}` : null, s.gender ? cap(s.gender) : null].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* ── Detail panel ── */}
          {selectedStudent && (
            <div ref={detailRef} style={S.card}>
              <div style={{ ...S.sectionHeader, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{selectedStudent.last_name}, {selectedStudent.first_name}</span>
                <button onClick={() => setSelectedId(null)} style={{ background: 'none', border: 'none', color: RCS.white, cursor: 'pointer', fontWeight: 900, fontSize: 18, lineHeight: 1 }}>✕</button>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 6, borderBottom: `2px solid ${RCS.lightBlue}`, paddingBottom: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {(['info', 'classes', 'notes', 'marks'] as Panel[]).map(p => (
                  <button key={p} onClick={() => setActivePanel(p)} style={{
                    padding: '6px 14px', borderRadius: 8, fontWeight: 900, cursor: 'pointer',
                    border: activePanel === p ? `1px solid ${RCS.gold}` : `1px solid transparent`,
                    background: activePanel === p ? RCS.paleGold : 'transparent',
                    color: activePanel === p ? RCS.deepNavy : RCS.midBlue,
                    textTransform: 'capitalize',
                  }}>
                    {p}{p === 'classes' ? ` (${enrollments.length})` : ''}{p === 'notes' ? ` (${notes.length})` : ''}{p === 'marks' ? ` (${marks.length})` : ''}
                  </button>
                ))}
              </div>

              {/* ── Info tab ── */}
              {activePanel === 'info' && editForm && (
                <div>
                  {/* Photo */}
                  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 18 }}>
                    <div style={{ width: 80, height: 80, borderRadius: 12, overflow: 'hidden', border: `2px solid ${RCS.deepNavy}`, background: RCS.paleGold, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      {signedUrl ? <img src={signedUrl} alt="photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 800 }}>No photo</span>}
                    </div>
                    <div>
                      <div style={S.label}>Photo</div>
                      <label style={{ display: 'inline-block', marginTop: 6 }}>
                        <span style={{ ...S.secondaryBtn, fontSize: 12, padding: '6px 10px', cursor: 'pointer', display: 'inline-block' }}>
                          {uploadStatus === 'working' ? 'Uploading…' : 'Upload photo'}
                        </span>
                        <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploadStatus === 'working'}
                          onChange={e => { const f = e.target.files?.[0]; if (f) { void uploadPhoto(f); e.currentTarget.value = ''; } }} />
                      </label>
                      {uploadError && <div style={{ fontSize: 12, color: '#7F1D1D', marginTop: 4 }}>{uploadError}</div>}
                    </div>
                  </div>

                  {/* Fields */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                    {[
                      { label: 'First name', key: 'first_name' },
                      { label: 'Last name', key: 'last_name' },
                      { label: 'Student #', key: 'student_number' },
                    ].map(({ label, key }) => (
                      <label key={key} style={S.fieldWrap}>
                        <span style={S.label}>{label}</span>
                        <input value={(editForm as any)[key] ?? ''} onChange={e => setEditForm(p => p ? { ...p, [key]: e.target.value } : p)} style={S.input} />
                      </label>
                    ))}
                    <label style={S.fieldWrap}>
                      <span style={S.label}>Grade year</span>
                      <select value={editForm.grade_year ?? ''} onChange={e => setEditForm(p => p ? { ...p, grade_year: e.target.value ? parseInt(e.target.value) : null } : p)} style={S.input}>
                        <option value="">— not set —</option>
                        {GRADE_YEARS.map(g => <option key={g} value={g}>Grade {g}</option>)}
                      </select>
                    </label>
                    <label style={S.fieldWrap}>
                      <span style={S.label}>Gender</span>
                      <select value={editForm.gender ?? ''} onChange={e => setEditForm(p => p ? { ...p, gender: e.target.value || null } : p)} style={S.input}>
                        <option value="">— not set —</option>
                        {GENDERS.map(g => <option key={g} value={g}>{cap(g)}</option>)}
                      </select>
                    </label>
                    <label style={S.fieldWrap}>
                      <span style={S.label}>School year</span>
                      <input value={editForm.school_year ?? ''} onChange={e => setEditForm(p => p ? { ...p, school_year: e.target.value || null } : p)} placeholder="e.g. 2025-26" style={S.input} />
                    </label>
                    <label style={S.fieldWrap}>
                      <span style={S.label}>Email</span>
                      <input value={editForm.email ?? ''} onChange={e => setEditForm(p => p ? { ...p, email: e.target.value || null } : p)} placeholder="student@rcseagles.ca" style={S.input} />
                    </label>
                  </div>

                  {editError && <div style={{ ...S.errorBox, marginTop: 10 }}>{editError}</div>}
                  <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button onClick={saveEdit} disabled={editStatus === 'working'} style={S.primaryBtn}>
                        {editStatus === 'working' ? 'Saving…' : 'Save Changes'}
                      </button>
                      {editStatus === 'saved' && <span style={{ color: '#14532d', fontWeight: 800, fontSize: 13 }}>✓ Saved</span>}
                    </div>
                    <button onClick={() => void deleteStudent(selectedStudent.id, `${selectedStudent.first_name} ${selectedStudent.last_name}`)} style={S.dangerSm}>Delete</button>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: RCS.midBlue, opacity: 0.8 }}>
                    Changes are visible in TOC-Dayplans, RCS Report Card Tool, Kawahoot, and Group Maker immediately.
                  </div>
                </div>
              )}

              {/* ── Classes tab ── */}
              {activePanel === 'classes' && (
                <div>
                  {enrollError && <div style={{ ...S.errorBox, marginBottom: 10 }}>{enrollError}</div>}
                  {enrollStatus === 'loading' && <div style={S.muted}>Loading…</div>}

                  {/* Current year — editable */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontWeight: 900, color: RCS.deepNavy, fontSize: 13, marginBottom: 8 }}>
                      {currentYear ? `${currentYear} — enroll or remove` : 'Current year — set School Year on the Info tab to enable year tracking'}
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {classes.filter(c => !['Flex', 'Lunch', 'Chapel', 'CLE'].includes(c.name)).map(cls => {
                        const enrolled = currentEnrolledIds.has(cls.id);
                        return (
                          <div key={cls.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 10, border: `1px solid ${enrolled ? RCS.gold : RCS.lightBlue}`, background: enrolled ? RCS.paleGold : RCS.white }}>
                            <span style={{ fontWeight: 900, color: RCS.deepNavy }}>
                              {cls.block_label ? `Block ${cls.block_label} – ` : ''}{cls.name}
                            </span>
                            <button
                              onClick={() => toggleEnrollment(cls.id, enrolled)}
                              disabled={enrollStatus === 'working'}
                              style={enrolled ? S.dangerSm : { ...S.primaryBtn, fontSize: 12, padding: '6px 12px' }}>
                              {enrolled ? 'Remove' : 'Enroll'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Past years — read-only */}
                  {(() => {
                    const pastEnrollments = enrollments.filter(e => e.school_year !== currentYear && e.school_year != null);
                    if (pastEnrollments.length === 0) return null;
                    const pastYears = [...new Set(pastEnrollments.map(e => e.school_year as string))].sort().reverse();
                    return (
                      <div>
                        <div style={{ fontWeight: 900, color: RCS.midBlue, fontSize: 13, marginBottom: 8, paddingTop: 4, borderTop: `1px solid ${RCS.lightBlue}` }}>
                          Past enrollments
                        </div>
                        {pastYears.map(year => {
                          const yearClasses = pastEnrollments
                            .filter(e => e.school_year === year)
                            .map(e => classes.find(c => c.id === e.class_id))
                            .filter((c): c is ClassRow => c !== undefined);
                          return (
                            <div key={year} style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 12, fontWeight: 800, color: RCS.midBlue, opacity: 0.75, marginBottom: 4 }}>{year}</div>
                              <div style={{ display: 'grid', gap: 4 }}>
                                {yearClasses.map(cls => (
                                  <div key={cls.id} style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${RCS.lightBlue}`, background: '#f8fbff', color: RCS.textDark, fontSize: 14, fontWeight: 700 }}>
                                    {cls.block_label ? `Block ${cls.block_label} – ` : ''}{cls.name}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Notes tab ── */}
              {activePanel === 'notes' && (
                <div>
                  <div style={{ marginBottom: 14 }}>
                    <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add a note…" rows={3}
                      style={{ ...S.input, width: '100%', resize: 'vertical', boxSizing: 'border-box' as const }} />
                    <button onClick={addNote} disabled={!newNote.trim() || notesStatus === 'working'} style={{ ...S.primaryBtn, marginTop: 8 }}>
                      {notesStatus === 'working' ? 'Saving…' : 'Add Note'}
                    </button>
                  </div>
                  {notesError && <div style={{ ...S.errorBox, marginBottom: 10 }}>{notesError}</div>}
                  {notesStatus === 'loading' && <div style={S.muted}>Loading…</div>}
                  {notes.length === 0 && notesStatus !== 'loading' && <div style={S.muted}>No notes yet.</div>}
                  <div style={{ display: 'grid', gap: 8 }}>
                    {notes.map(n => (
                      <div key={n.id} style={S.noteCard}>
                        {editingNoteId === n.id ? (
                          <div>
                            <textarea value={editingNoteText} onChange={e => setEditingNoteText(e.target.value)} rows={3}
                              style={{ ...S.input, width: '100%', resize: 'vertical', boxSizing: 'border-box' as const }} />
                            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                              <button onClick={() => saveNote(n.id)} style={S.primaryBtn}>Save</button>
                              <button onClick={() => { setEditingNoteId(null); setEditingNoteText(''); }} style={S.secondaryBtn}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                            <div>
                              <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{n.note}</div>
                              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>{fmtDate(n.created_at)}{n.updated_at !== n.created_at ? ' (edited)' : ''}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                              <button onClick={() => { setEditingNoteId(n.id); setEditingNoteText(n.note); }} style={S.editSm}>Edit</button>
                              <button onClick={() => deleteNote(n.id)} style={S.dangerSm}>Del</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Marks tab ── */}
              {activePanel === 'marks' && (
                <div>
                  {marksError && <div style={{ ...S.errorBox, marginBottom: 10 }}>{marksError}</div>}
                  {!showAddMark && <button onClick={() => setShowAddMark(true)} style={{ ...S.primaryBtn, marginBottom: 14 }}>+ Add Mark</button>}
                  {showAddMark && (
                    <div style={{ ...S.noteCard, marginBottom: 14 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
                        <label style={S.fieldWrap}>
                          <span style={S.label}>Subject *</span>
                          <input value={markForm.subject} onChange={e => setMarkForm(p => ({ ...p, subject: e.target.value }))} style={S.input} placeholder="e.g. Math 9" />
                        </label>
                        <label style={S.fieldWrap}>
                          <span style={S.label}>Mark *</span>
                          <input value={markForm.mark} onChange={e => setMarkForm(p => ({ ...p, mark: e.target.value }))} style={S.input} placeholder="87% or A" />
                        </label>
                        <label style={S.fieldWrap}>
                          <span style={S.label}>Quarter</span>
                          <select value={markForm.quarter} onChange={e => setMarkForm(p => ({ ...p, quarter: e.target.value }))} style={S.input}>
                            <option value="">—</option>
                            {[1,2,3,4].map(q => <option key={q} value={q}>Q{q}</option>)}
                          </select>
                        </label>
                        <label style={S.fieldWrap}>
                          <span style={S.label}>Class (optional)</span>
                          <select value={markForm.class_id} onChange={e => setMarkForm(p => ({ ...p, class_id: e.target.value }))} style={S.input}>
                            <option value="">—</option>
                            {classes.map(c => <option key={c.id} value={c.id}>{c.block_label ? `Blk ${c.block_label} – ` : ''}{c.name}</option>)}
                          </select>
                        </label>
                        <label style={{ ...S.fieldWrap, gridColumn: '1 / -1' }}>
                          <span style={S.label}>Note</span>
                          <input value={markForm.note} onChange={e => setMarkForm(p => ({ ...p, note: e.target.value }))} style={S.input} placeholder="Optional context" />
                        </label>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={addMark} disabled={!markForm.subject.trim() || !markForm.mark.trim() || marksStatus === 'working'} style={S.primaryBtn}>Save</button>
                        <button onClick={() => { setShowAddMark(false); setMarkForm({ subject: '', mark: '', quarter: '', class_id: '', note: '' }); }} style={S.secondaryBtn}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {marksStatus === 'loading' && <div style={S.muted}>Loading…</div>}
                  {marks.length === 0 && marksStatus !== 'loading' && <div style={S.muted}>No marks yet.</div>}
                  <div style={{ display: 'grid', gap: 8 }}>
                    {marks.map(m => {
                      const cls = m.class_id ? classes.find(c => c.id === m.class_id) : null;
                      return (
                        <div key={m.id} style={{ ...S.noteCard, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 900, color: RCS.deepNavy }}>{m.subject} — <span style={{ color: RCS.midBlue }}>{m.mark}</span>{m.quarter ? <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 8 }}>Q{m.quarter}</span> : ''}</div>
                            {cls && <div style={{ fontSize: 12, opacity: 0.7 }}>{cls.block_label ? `Blk ${cls.block_label} – ` : ''}{cls.name}</div>}
                            {m.note && <div style={{ fontSize: 12, opacity: 0.7 }}>{m.note}</div>}
                            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{fmtDate(m.created_at)}</div>
                          </div>
                          <button onClick={() => deleteMark(m.id)} style={S.dangerSm}>Del</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }); }
function humanizeError(e: any): string {
  const code = e?.code as string | undefined;
  const msg = (e?.message as string | undefined) ?? '';
  if (code === '42501' || /permission denied|rls/i.test(msg)) return 'Permission denied. Are you signed in as staff?';
  if (code === '23505' || /duplicate key/i.test(msg)) return 'That student is already enrolled in this class.';
  if (code === '42P01' || /does not exist/i.test(msg)) return 'A required table is missing — run the migration SQL in Supabase first.';
  return msg || 'Unknown error.';
}

// ── Styles ────────────────────────────────────────────────────────────────────

const RCS_c = { deepNavy: '#1F4E79', midBlue: '#2E75B6', lightBlue: '#D6E4F0', gold: '#C9A84C', paleGold: '#FDF3DC', white: '#FFFFFF' };

const S: Record<string, React.CSSProperties> = {
  card: { background: '#fff', border: `1px solid ${RCS_c.deepNavy}`, borderRadius: 12, padding: 16 },
  sectionHeader: { background: RCS_c.deepNavy, color: '#fff', padding: '8px 10px', borderRadius: 10, borderBottom: `3px solid ${RCS_c.gold}`, fontWeight: 900, marginBottom: 12 },
  fieldWrap: { display: 'grid', gap: 4 },
  label: { color: RCS_c.midBlue, fontWeight: 800, fontSize: 12 },
  muted: { opacity: 0.7, fontSize: 13, padding: '6px 0' },
  input: { padding: '9px 11px', borderRadius: 10, border: `1px solid ${RCS_c.deepNavy}`, background: '#fff', color: '#1A1A1A', fontSize: 14 },
  primaryBtn: { padding: '10px 16px', borderRadius: 10, background: RCS_c.deepNavy, border: `1px solid ${RCS_c.gold}`, color: '#fff', fontWeight: 900, cursor: 'pointer' },
  secondaryBtn: { padding: '10px 14px', borderRadius: 10, border: `1px solid ${RCS_c.gold}`, background: 'transparent', color: RCS_c.deepNavy, fontWeight: 900, cursor: 'pointer' },
  navBtn: { padding: '8px 14px', borderRadius: 8, border: `1px solid rgba(255,255,255,0.3)`, background: 'transparent', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' },
  navBtnGold: { padding: '8px 14px', borderRadius: 8, border: `1px solid ${RCS_c.gold}`, background: RCS_c.gold, color: RCS_c.deepNavy, fontWeight: 900, fontSize: 13, cursor: 'pointer' },
  navBtnOutline: { padding: '8px 14px', borderRadius: 8, border: `1px solid ${RCS_c.gold}`, background: 'transparent', color: RCS_c.gold, fontWeight: 900, fontSize: 13, cursor: 'pointer' },
  dangerSm: { padding: '6px 10px', borderRadius: 8, border: '1px solid #991b1b', background: '#FEE2E2', color: '#7F1D1D', fontWeight: 900, fontSize: 12, cursor: 'pointer' },
  editSm: { padding: '6px 10px', borderRadius: 8, border: `1px solid ${RCS_c.gold}`, background: RCS_c.paleGold, color: RCS_c.deepNavy, fontWeight: 900, fontSize: 12, cursor: 'pointer' },
  errorBox: { padding: 12, borderRadius: 10, background: '#FEE2E2', border: '1px solid #991b1b', color: '#7F1D1D' },
  noteCard: { padding: 12, borderRadius: 10, border: `1px solid ${RCS_c.lightBlue}`, background: '#f8fbff' },
};
