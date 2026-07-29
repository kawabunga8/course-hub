'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import Banner from '@/components/Banner';

const BUCKET = 'Student Photos';

const RCS = {
  deepNavy: '#1F4E79', midBlue: '#2E75B6', lightBlue: '#D6E4F0',
  gold: '#C9A84C', paleGold: '#FDF3DC', white: '#FFFFFF', textDark: '#1A1A1A',
  green: '#166534', paleGreen: '#dcfce7', red: '#991b1b', paleRed: '#fee2e2',
  gray: '#6b7280', lightGray: '#f5f5f5',
} as const;

type Student = {
  id: string;
  first_name: string;
  last_name: string;
  student_number: string | null;
  photo_url: string | null;
  photo_history: { url: string; replaced_at: string }[];
};

type MatchResult = {
  file: File;
  parsedNumber: string;
  parsedName: string;
  student: Student | null;
  previewObjectUrl: string;
  oldSignedUrl: string | null;
  status: 'matched' | 'unmatched';
};

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

function parseFilename(filename: string): { number: string; name: string } | null {
  const base = filename.replace(/\.[^.]+$/, '');
  const match = base.match(/^(\d+)-(.+)$/);
  if (!match) return null;
  return { number: match[1]!, name: match[2]!.replace(/_/g, ' ') };
}

export default function PhotosClient() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [log, setLog] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sb = getSupabaseClient();
    sb.from('students')
      .select('id,first_name,last_name,student_number,photo_url,photo_history')
      .order('last_name')
      .then(({ data }) => {
        setStudents((data ?? []) as Student[]);
        setLoading(false);
      });
  }, []);

  async function handleFiles(files: FileList) {
    const sb = getSupabaseClient();
    const byNumber = new Map(students.filter(s => s.student_number).map(s => [s.student_number!, s]));
    const results: MatchResult[] = [];

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const parsed = parseFilename(file.name);
      if (!parsed) continue;

      const student = byNumber.get(parsed.number) ?? null;
      let oldSignedUrl: string | null = null;

      if (student?.photo_url) {
        const { data } = await sb.storage.from(BUCKET).createSignedUrl(student.photo_url, 3600);
        oldSignedUrl = data?.signedUrl ?? null;
      }

      results.push({
        file,
        parsedNumber: parsed.number,
        parsedName: parsed.name,
        student,
        previewObjectUrl: URL.createObjectURL(file),
        oldSignedUrl,
        status: student ? 'matched' : 'unmatched',
      });
    }

    setMatches(results);
    setUploadState('idle');
    setLog([]);
    setProgress({ done: 0, total: 0 });
  }

  async function runUpload() {
    const sb = getSupabaseClient();
    const toUpload = matches.filter(m => m.status === 'matched' && m.student);
    setUploadState('uploading');
    setProgress({ done: 0, total: toUpload.length });
    const newLog: string[] = [];

    for (let i = 0; i < toUpload.length; i++) {
      const m = toUpload[i]!;
      const student = m.student!;
      const path = `${m.parsedNumber}-${m.file.name.replace(/^[^-]+-/, '')}`;

      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, m.file, { upsert: true, contentType: m.file.type });
      if (upErr) { newLog.push(`✗ ${student.last_name}, ${student.first_name}: ${upErr.message}`); continue; }

      const history = Array.isArray(student.photo_history) ? student.photo_history : [];
      if (student.photo_url) {
        history.push({ url: student.photo_url, replaced_at: new Date().toISOString() });
      }

      const { error: dbErr } = await sb.from('students').update({ photo_url: path, photo_history: history }).eq('id', student.id);
      if (dbErr) { newLog.push(`✗ ${student.last_name}, ${student.first_name}: ${dbErr.message}`); continue; }

      newLog.push(`✓ ${student.last_name}, ${student.first_name}`);
      setProgress({ done: i + 1, total: toUpload.length });
    }

    setLog(newLog);
    setUploadState('done');
  }

  const matched = matches.filter(m => m.status === 'matched');
  const unmatched = matches.filter(m => m.status === 'unmatched');

  return (
    <>
      <Banner active="students" />
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', fontFamily: 'system-ui', color: RCS.textDark }}>
        <h1 style={{ color: RCS.deepNavy, margin: '0 0 4px' }}>Bulk Photo Upload</h1>
        <p style={{ color: RCS.gray, marginBottom: 24 }}>
          Upload portrait files named <code>{'{student_number}-Last_First.jpg'}</code>. Each file is matched to a student by number.
          Existing photos are archived to photo history before being replaced.
        </p>

        {loading ? <p>Loading students…</p> : (
          <>
            <div
              style={{ border: `2px dashed ${RCS.gold}`, borderRadius: 12, padding: 32, textAlign: 'center', background: RCS.paleGold, cursor: 'pointer', marginBottom: 24 }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files); }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
              <div style={{ fontWeight: 800, color: RCS.deepNavy, fontSize: 16 }}>Drop portrait files here or click to browse</div>
              <div style={{ color: RCS.gray, fontSize: 13, marginTop: 4 }}>Accepts JPG/PNG — select all files from a class folder at once</div>
              <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={e => { if (e.target.files?.length) void handleFiles(e.target.files); }} />
            </div>

            {matches.length > 0 && (
              <>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, color: RCS.deepNavy }}>{matches.length} files loaded</span>
                  <span style={{ background: RCS.paleGreen, color: RCS.green, borderRadius: 6, padding: '3px 10px', fontWeight: 700, fontSize: 13 }}>{matched.length} matched</span>
                  {unmatched.length > 0 && <span style={{ background: RCS.paleRed, color: RCS.red, borderRadius: 6, padding: '3px 10px', fontWeight: 700, fontSize: 13 }}>{unmatched.length} unmatched</span>}
                  {uploadState === 'idle' && matched.length > 0 && (
                    <button onClick={() => void runUpload()} style={{ marginLeft: 'auto', padding: '8px 20px', borderRadius: 8, border: 'none', background: RCS.deepNavy, color: RCS.white, fontWeight: 800, cursor: 'pointer', fontSize: 14 }}>
                      Upload {matched.length} photo{matched.length !== 1 ? 's' : ''}
                    </button>
                  )}
                  {uploadState === 'uploading' && (
                    <span style={{ marginLeft: 'auto', color: RCS.midBlue, fontWeight: 700 }}>Uploading {progress.done}/{progress.total}…</span>
                  )}
                </div>

                {uploadState === 'done' && (
                  <div style={{ background: RCS.paleGreen, border: `1px solid ${RCS.green}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
                    <div style={{ fontWeight: 800, color: RCS.green, marginBottom: 8 }}>Upload complete</div>
                    <pre style={{ margin: 0, fontSize: 12, color: RCS.textDark, whiteSpace: 'pre-wrap' }}>{log.join('\n')}</pre>
                  </div>
                )}

                {matched.length > 0 && (
                  <section style={{ marginBottom: 32 }}>
                    <h2 style={{ color: RCS.deepNavy, fontSize: 16, marginBottom: 12 }}>Matched — will be uploaded</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                      {matched.map((m, i) => (
                        <div key={i} style={{ border: `1px solid ${RCS.lightBlue}`, borderRadius: 10, overflow: 'hidden', background: RCS.white }}>
                          <div style={{ display: 'flex' }}>
                            <div style={{ flex: 1, aspectRatio: '1', overflow: 'hidden', background: RCS.lightGray }}>
                              {m.oldSignedUrl
                                ? <img src={m.oldSignedUrl} alt="current" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: RCS.gray }}>No photo</div>
                              }
                            </div>
                            <div style={{ width: 4, background: RCS.gold }} />
                            <div style={{ flex: 1, aspectRatio: '1', overflow: 'hidden' }}>
                              <img src={m.previewObjectUrl} alt="new" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                          </div>
                          <div style={{ padding: '8px 10px' }}>
                            <div style={{ fontWeight: 800, fontSize: 13, color: RCS.deepNavy }}>{m.student!.last_name}, {m.student!.first_name}</div>
                            <div style={{ fontSize: 11, color: RCS.gray }}>#{m.parsedNumber}</div>
                            {m.oldSignedUrl && <div style={{ fontSize: 10, color: RCS.gold, fontWeight: 700, marginTop: 2 }}>↓ old photo will be archived</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {unmatched.length > 0 && (
                  <section>
                    <h2 style={{ color: RCS.red, fontSize: 16, marginBottom: 12 }}>Unmatched — will not be uploaded</h2>
                    <p style={{ color: RCS.gray, fontSize: 13, marginBottom: 12 }}>No student found with these numbers. Add the student to Student Hub first, then re-upload.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                      {unmatched.map((m, i) => (
                        <div key={i} style={{ border: `1px solid ${RCS.red}`, borderRadius: 10, overflow: 'hidden', background: RCS.white, opacity: 0.7 }}>
                          <div style={{ aspectRatio: '1', overflow: 'hidden' }}>
                            <img src={m.previewObjectUrl} alt="unmatched" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                          <div style={{ padding: '8px 10px' }}>
                            <div style={{ fontWeight: 800, fontSize: 13, color: RCS.red }}>#{m.parsedNumber}</div>
                            <div style={{ fontSize: 11, color: RCS.gray }}>{m.parsedName}</div>
                            <div style={{ fontSize: 10, color: RCS.red, marginTop: 2 }}>Not in Student Hub</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
