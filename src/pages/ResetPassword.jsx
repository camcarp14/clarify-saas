import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Landing page for Supabase recovery links (and a plain change-password screen
// for anyone already signed in who navigates here directly).
export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async () => {
    if (password.length < 8) { setMsg({ warn: true, text: 'Use at least 8 characters.' }); return; }
    if (password !== confirm) { setMsg({ warn: true, text: "Those don't match." }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setMsg({ warn: true, text: error.message }); return; }
    setMsg({ warn: false, text: 'Password updated — taking you to your dashboard.' });
    setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
  };

  return (
    <div style={{ maxWidth: 440, margin: '48px auto 0' }}>
      <div className="section">
        <h2>Set a new password</h2>
        <p className="muted" style={{ margin: '6px 0 16px' }}>Pick something you haven't used elsewhere.</p>
        <div style={{ display: 'grid', gap: 10 }}>
          <label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label>Confirm it<input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        </div>
        {msg && <div className={`banner ${msg.warn ? 'warn' : 'trial'}`} style={{ marginTop: 12 }}>{msg.text}</div>}
        <button className="btn primary" style={{ marginTop: 12 }} disabled={busy || !password || !confirm} onClick={submit}>
          {busy ? 'Saving…' : 'Update password'}
        </button>
      </div>
    </div>
  );
}
