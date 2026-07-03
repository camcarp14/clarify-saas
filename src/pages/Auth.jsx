import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Auth() {
  const [mode, setMode] = useState('login');
  const [company, setCompany] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { company_name: company, full_name: name } },
        });
        if (error) throw error;
        if (!data.session) setMsg({ ok: true, text: 'Check your email to confirm your account, then sign in.' });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card fade-in">
        <div className="brand" style={{ padding: 0, fontSize: 24 }}>Clari<em style={{ color: 'var(--clarity)', fontStyle: 'normal' }}>fy</em></div>
        <p className="muted" style={{ margin: 0 }}>
          {mode === 'signup' ? 'See what your Google Ads money is actually doing.' : 'Welcome back.'}
        </p>
        {mode === 'signup' && (
          <>
            <input placeholder="Business name" value={company} onChange={(e) => setCompany(e.target.value)} />
            <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          </>
        )}
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        {msg && <div className={`banner ${msg.ok ? 'trial' : 'warn'}`} style={{ margin: 0 }}>{msg.text}</div>}
        <button className="btn primary" disabled={busy || !email || !password || (mode === 'signup' && !company)} onClick={submit}>
          {busy ? 'One sec…' : mode === 'signup' ? 'Start free trial' : 'Sign in'}
        </button>
        <button className="btn ghost" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setMsg(null); }}>
          {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Start a 14-day trial'}
        </button>
        {mode === 'signup' && <div className="faint">No card required for the trial.</div>}
      </div>
    </div>
  );
}
