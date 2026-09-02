'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabaseClient';

const RCS = {
  deepNavy: '#1F4E79', midBlue: '#2E75B6', gold: '#C9A84C',
  paleGold: '#FDF3DC', white: '#FFFFFF', textDark: '#1A1A1A',
} as const;

export default function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const raw = sp.get('next') || '/students';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/students';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [status, setStatus] = useState<'idle' | 'working' | 'error' | 'reset-sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setStatus('working'); setError(null);
    try {
      const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push(next);
    } catch (err: any) {
      setStatus('error'); setError(err?.message ?? 'Sign-in failed');
    }
  }

  async function sendReset() {
    if (!email.trim()) { setStatus('error'); setError('Enter your email first.'); return; }
    setStatus('working'); setError(null);
    try {
      const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      if (error) throw error;
      setStatus('reset-sent');
    } catch (err: any) {
      setStatus('error'); setError(err?.message ?? 'Failed.');
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: '#f0f4f8', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Header */}
        <div style={{ background: RCS.deepNavy, borderRadius: '14px 14px 0 0', borderBottom: `4px solid ${RCS.gold}`, padding: '20px 24px' }}>
          <div style={{ color: RCS.gold, fontWeight: 900, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
            Richmond Christian School
          </div>
          <div style={{ color: RCS.white, fontWeight: 900, fontSize: 22 }}>Course Hub</div>
        </div>

        {/* Form */}
        <div style={{ background: RCS.white, border: `1px solid ${RCS.deepNavy}`, borderTop: 0, borderRadius: '0 0 14px 14px', padding: 24 }}>
          <form onSubmit={signIn} style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 5 }}>
              <span style={{ color: RCS.midBlue, fontWeight: 800, fontSize: 12 }}>Email</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@myrcs.ca"
                style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${RCS.deepNavy}`, fontSize: 14 }} />
            </label>
            <label style={{ display: 'grid', gap: 5 }}>
              <span style={{ color: RCS.midBlue, fontWeight: 800, fontSize: 12 }}>Password</span>
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${RCS.deepNavy}`, fontSize: 14 }} />
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, opacity: 0.8 }}>
                <input type="checkbox" checked={showPw} onChange={e => setShowPw(e.target.checked)} />
                Show password
              </label>
            </label>

            {error && <div style={{ padding: 10, borderRadius: 8, background: '#FEE2E2', border: '1px solid #991b1b', color: '#7F1D1D', fontSize: 13 }}>{error}</div>}
            {status === 'reset-sent' && <div style={{ padding: 10, borderRadius: 8, background: '#dcfce7', border: '1px solid #86efac', fontSize: 13 }}>Reset email sent — check your inbox.</div>}

            <button type="submit" disabled={status === 'working'}
              style={{ padding: '11px 16px', borderRadius: 10, background: RCS.deepNavy, border: `1px solid ${RCS.gold}`, color: RCS.white, fontWeight: 900 }}>
              {status === 'working' ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" onClick={sendReset} disabled={status === 'working'}
              style={{ padding: '10px 16px', borderRadius: 10, border: `1px solid ${RCS.gold}`, background: 'transparent', color: RCS.deepNavy, fontWeight: 900 }}>
              Forgot password
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
