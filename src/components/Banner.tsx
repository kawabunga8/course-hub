'use client';

import { getSupabaseClient } from '@/lib/supabaseClient';

const RCS = { deepNavy: '#1F4E79', midBlue: '#2E75B6', gold: '#C9A84C', white: '#FFFFFF' } as const;

const navBtn = { padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' } as const;
const navBtnActive = { ...navBtn, border: `1px solid ${RCS.gold}`, background: RCS.gold, color: RCS.deepNavy, fontWeight: 900 } as const;
const navBtnOutline = { padding: '8px 14px', borderRadius: 8, border: `1px solid ${RCS.gold}`, background: 'transparent', color: RCS.gold, fontWeight: 900, fontSize: 13, cursor: 'pointer' } as const;

type Page = 'students' | 'courses' | 'standards' | 'quarters' | 'photos';

const LINKS: { page: Page; href: string; label: string }[] = [
  { page: 'students', href: '/students', label: 'Students' },
  { page: 'photos', href: '/students/photos', label: 'Photos' },
  { page: 'courses', href: '/courses', label: 'Courses' },
  { page: 'standards', href: '/standards', label: 'Learning Standards' },
  { page: 'quarters', href: '/quarters', label: 'School Quarters' },
];

export default function Banner({ active }: { active: Page }) {
  async function signOut() {
    await getSupabaseClient().auth.signOut();
    window.location.href = '/login';
  }

  return (
    <header style={{ background: RCS.deepNavy, borderBottom: `4px solid ${RCS.gold}`, padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <div style={{ color: RCS.gold, fontWeight: 900, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>Richmond Christian School</div>
        <div style={{ color: RCS.white, fontWeight: 900, fontSize: 20 }}>Student Hub</div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {LINKS.map(l => (
          <a key={l.page} href={l.href} style={l.page === active ? navBtnActive : navBtn}>{l.label}</a>
        ))}
        <button onClick={signOut} style={navBtnOutline}>Sign out</button>
      </div>
    </header>
  );
}
