'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import Banner from '@/components/Banner';
import { currentSchoolYear } from '@/lib/school-year';

type FlexDay = { day: string; heading: string; details: string | null; flex_letter: string | null; source: string | null; updated_at: string };
type FlexRoom = { flex_letter: string; room: string; note: string | null };
type RoomDraft = { room: string; note: string };

const RCS = {
  deepNavy: '#1F4E79', midBlue: '#2E75B6', lightBlue: '#D6E4F0',
  gold: '#C9A84C', paleGold: '#FDF3DC', white: '#FFFFFF', textDark: '#1A1A1A',
} as const;

const LETTERS = ['A', 'B', 'C', 'D'] as const;
// The campus FLEX Schedule colours (A orange, B green, C pink, D blue), lightened.
const LETTER_BG: Record<string, string> = { A: '#FBE3D6', B: '#DCF5DD', C: '#F6E0F3', D: '#DDF0FA' };
// Only for shading; the sheet's own words are what's shown.
const DAY_OFF = /\b(no school|pro d|ptcs?|break|labour day|completion day)\b/i;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// Dates are calendar days, so do the arithmetic in UTC to avoid time-zone shifts.
function addDays(iso: string, n: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function emptyRooms(): Record<string, RoomDraft> {
  return Object.fromEntries(LETTERS.map(l => [l, { room: '', note: '' }]));
}

export default function FlexClient() {
  const [years, setYears] = useState<string[]>([]);
  const [schoolYear, setSchoolYear] = useState<string>(currentSchoolYear);
  const [days, setDays] = useState<FlexDay[]>([]);
  const [rooms, setRooms] = useState<Record<string, RoomDraft>>(emptyRooms);
  const [savedRooms, setSavedRooms] = useState<Record<string, RoomDraft>>(emptyRooms);
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const today = localToday();

  useEffect(() => {
    (async () => {
      const { data } = await getSupabaseClient().from('school_years').select('code').order('code');
      if (data) setYears(data.map(r => String(r.code)));
    })();
  }, []);

  async function load() {
    setStatus('loading');
    setError(null);
    const sb = getSupabaseClient();
    const [dayRes, roomRes] = await Promise.all([
      sb.from('flex_days').select('day,heading,details,flex_letter,source,updated_at').eq('school_year', schoolYear).order('day'),
      sb.from('flex_rooms').select('flex_letter,room,note').eq('school_year', schoolYear),
    ]);
    const err = dayRes.error || roomRes.error;
    if (err) { setError(err.message); setStatus('error'); return; }
    setDays((dayRes.data ?? []) as FlexDay[]);
    const map = emptyRooms();
    for (const r of (roomRes.data ?? []) as FlexRoom[]) map[r.flex_letter] = { room: r.room, note: r.note ?? '' };
    setRooms(map);
    setSavedRooms(map);
    setStatus('idle');
  }

  // `load` is redefined every render; `schoolYear` is the only real trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [schoolYear]);

  async function saveRooms() {
    setStatus('saving');
    setError(null);
    const sb = getSupabaseClient();
    const filled = LETTERS.filter(l => rooms[l].room.trim());
    const cleared = LETTERS.filter(l => !rooms[l].room.trim());
    if (filled.length) {
      const { error } = await sb.from('flex_rooms').upsert(
        filled.map(l => ({ school_year: schoolYear, flex_letter: l, room: rooms[l].room.trim(), note: rooms[l].note.trim() || null })),
        { onConflict: 'school_year,flex_letter' },
      );
      if (error) { setError(error.message); setStatus('error'); return; }
    }
    if (cleared.length) {
      const { error } = await sb.from('flex_rooms').delete().eq('school_year', schoolYear).in('flex_letter', cleared);
      if (error) { setError(error.message); setStatus('error'); return; }
    }
    const next = emptyRooms();
    for (const l of filled) next[l] = { room: rooms[l].room.trim(), note: rooms[l].note.trim() };
    setRooms(next);
    setSavedRooms(next);
    setStatus('saved');
  }

  const weeks = useMemo(() => {
    const byDay = new Map(days.map(d => [d.day, d]));
    const mondays = [...new Set(days.map(d => mondayOf(d.day)))].sort();
    return mondays.map(monday => ({ monday, cells: WEEKDAYS.map((_, i) => byDay.get(addDays(monday, i)) ?? null) }));
  }, [days]);

  const source = days.find(d => d.source)?.source ?? null;
  const lastLoaded = days.reduce((latest, d) => (d.updated_at > latest ? d.updated_at : latest), '');
  const roomsChanged = LETTERS.some(l => rooms[l].room !== savedRooms[l].room || rooms[l].note !== savedRooms[l].note);
  const inputStyle = { padding: 6, border: `1px solid ${RCS.deepNavy}`, borderRadius: 6, minWidth: 0 } as const;

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: 'system-ui, sans-serif' }}>
      <Banner active="flex" />
      <div style={{ padding: 24, color: RCS.textDark }}>
        <h1 style={{ color: RCS.deepNavy, marginTop: 0 }}>Flex Schedule</h1>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 16, maxWidth: 720 }}>
          What happens in the flex slot on each school day, from the VP office&apos;s flex schedule sheet, and where you go on
          A–D Flex days. TOC Day Plans reads this through Course Hub&apos;s API (<code>/api/flex</code>).
        </p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: RCS.deepNavy }}>School year</span>
          <select
            value={schoolYear}
            onChange={e => setSchoolYear(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${RCS.deepNavy}`, background: RCS.white, color: RCS.textDark, fontWeight: 700 }}>
            {(years.length ? years : [schoolYear]).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {status === 'loading' && <div>Loading…</div>}
        {error && <div style={{ color: 'crimson', marginBottom: 12 }}>{error}</div>}

        {status !== 'loading' && (
          <>
            <section style={{ border: `1px solid ${RCS.deepNavy}`, borderRadius: 12, padding: 16, background: RCS.paleGold, maxWidth: 520, marginBottom: 20 }}>
              <h2 style={{ color: RCS.deepNavy, fontSize: 16, margin: '0 0 4px' }}>My flex rooms</h2>
              <p style={{ fontSize: 12, color: '#555', margin: '0 0 12px' }}>Where you go on each kind of Flex day. Leave a room blank if you have none.</p>
              <div style={{ display: 'grid', gap: 8 }}>
                {LETTERS.map(l => (
                  <div key={l} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 1fr', gap: 8, alignItems: 'center' }}>
                    <span style={{ background: LETTER_BG[l], borderRadius: 6, padding: '6px 8px', fontWeight: 900, textAlign: 'center' }}>{l} Flex</span>
                    <input aria-label={`${l} Flex room`} placeholder="Room" value={rooms[l].room} style={inputStyle}
                      onChange={e => { const v = e.target.value; setRooms(prev => ({ ...prev, [l]: { ...prev[l], room: v } })); }} />
                    <input aria-label={`${l} Flex note`} placeholder="Note (e.g. Grade 12s)" value={rooms[l].note} style={inputStyle}
                      onChange={e => { const v = e.target.value; setRooms(prev => ({ ...prev, [l]: { ...prev[l], note: v } })); }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
                <button
                  onClick={saveRooms}
                  disabled={status === 'saving' || !roomsChanged}
                  style={{ background: RCS.deepNavy, color: RCS.white, border: `1px solid ${RCS.gold}`, borderRadius: 10, fontWeight: 900, padding: '8px 16px', cursor: roomsChanged ? 'pointer' : 'default', opacity: roomsChanged ? 1 : 0.6 }}>
                  {status === 'saving' ? 'Saving…' : 'Save rooms'}
                </button>
                {status === 'saved' && !roomsChanged && <span style={{ fontSize: 13, color: '#166534', fontWeight: 700 }}>Saved</span>}
              </div>
            </section>

            {days.length === 0 ? (
              <div style={{ color: '#7F1D1D' }}>No flex schedule loaded for {schoolYear} yet.</div>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'separate', borderSpacing: 4, minWidth: 760, fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', color: RCS.deepNavy, padding: '4px 6px' }}>Week of</th>
                        {WEEKDAYS.map(w => <th key={w} style={{ textAlign: 'left', color: RCS.deepNavy, padding: '4px 6px' }}>{w}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {weeks.map(week => (
                        <tr key={week.monday}>
                          <td style={{ fontWeight: 800, color: RCS.midBlue, verticalAlign: 'top', padding: '8px 6px', whiteSpace: 'nowrap' }}>{shortDate(week.monday)}</td>
                          {week.cells.map((d, i) => {
                            const iso = addDays(week.monday, i);
                            const isToday = iso === today;
                            const room = d?.flex_letter ? savedRooms[d.flex_letter] : undefined;
                            const background = !d ? '#F8FAFC' : d.flex_letter ? LETTER_BG[d.flex_letter] : DAY_OFF.test(d.heading) ? '#E5E7EB' : RCS.white;
                            return (
                              <td key={iso} style={{ verticalAlign: 'top', background, borderRadius: 8, padding: '6px 8px', width: '18%',
                                border: isToday ? `3px solid ${RCS.gold}` : '1px solid #D9E2EC' }}>
                                <div style={{ fontSize: 11, color: '#555' }}>{shortDate(iso)}{isToday ? ' · Today' : ''}</div>
                                {d ? (
                                  <>
                                    <div style={{ fontWeight: 800 }}>{d.heading}</div>
                                    {d.details && <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>{d.details}</div>}
                                    {room?.room && (
                                      <div style={{ fontSize: 12, fontWeight: 800, color: RCS.deepNavy, marginTop: 2 }}>
                                        → {room.room}{room.note ? ` · ${room.note}` : ''}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div style={{ color: '#94A3B8' }}>—</div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 12, color: '#555', marginTop: 12, maxWidth: 720 }}>
                  {source ? `Source: ${source}. ` : ''}
                  {lastLoaded ? `Last loaded ${new Date(lastLoaded).toLocaleDateString('en-CA')}. ` : ''}
                  The sheet is the original. When it changes, re-import it rather than editing days here.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
