'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import Banner from '@/components/Banner';

type DocSummary = {
  id: string;
  title: string;
  school_year: string | null;
  source_filename: string | null;
};

const RCS = {
  deepNavy: '#1F4E79', midBlue: '#2E75B6', lightBlue: '#D6E4F0',
  gold: '#C9A84C', paleGold: '#FDF3DC', white: '#FFFFFF', textDark: '#1A1A1A',
} as const;

export default function DocumentsClient() {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // The list leaves out `content` — each row is a whole document.
      const { data, error } = await getSupabaseClient()
        .from('school_documents')
        .select('id,title,school_year,source_filename')
        .order('school_year', { ascending: false, nullsFirst: false })
        .order('title');
      if (error) { setError(error.message); setStatus('error'); return; }
      const rows = (data ?? []) as DocSummary[];
      setDocs(rows);
      if (rows.length) setSelectedId(rows[0].id);
      setStatus('idle');
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    let cancelled = false;
    (async () => {
      const { data, error } = await getSupabaseClient()
        .from('school_documents')
        .select('content')
        .eq('id', id)
        .single();
      if (cancelled) return;
      if (error) setError(error.message);
      else setContent(data?.content ?? '');
      setLoadedId(id);
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const selected = docs.find(d => d.id === selectedId);
  const contentLoading = selectedId !== null && loadedId !== selectedId;

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: 'system-ui, sans-serif' }}>
      <Banner active="documents" />
      <div style={{ padding: 24, color: RCS.textDark }}>
        <h1 style={{ color: RCS.deepNavy, marginTop: 0 }}>School Documents</h1>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 16 }}>
          School-wide reference documents. Text is extracted from each source file for reading and searching.
        </p>

        {status === 'loading' && <div>Loading…</div>}
        {error && <div style={{ color: 'crimson', marginBottom: 12 }}>{error}</div>}
        {status === 'idle' && docs.length === 0 && (
          <div style={{ color: '#7F1D1D' }}>No documents yet.</div>
        )}

        {docs.length > 0 && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: 8, width: 280, maxWidth: '100%' }}>
              {docs.map(d => {
                const active = d.id === selectedId;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    style={{
                      textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                      border: `1px solid ${active ? RCS.gold : RCS.deepNavy}`,
                      background: active ? RCS.paleGold : RCS.white, color: RCS.textDark,
                    }}
                  >
                    <div style={{ fontWeight: 900, color: RCS.deepNavy }}>{d.title}</div>
                    <div style={{ fontSize: 12, color: '#555' }}>
                      {[d.school_year, d.source_filename].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ flex: '1 1 480px', minWidth: 0, border: `1px solid ${RCS.deepNavy}`, borderRadius: 12, background: RCS.white, padding: 20 }}>
              {selected && <h2 style={{ color: RCS.deepNavy, marginTop: 0 }}>{selected.title}</h2>}
              {contentLoading ? <div>Loading…</div> : (
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                  {content}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
