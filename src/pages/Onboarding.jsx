import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Spinner } from '../components/ui';

export default function Onboarding() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const pick = params.get('pick');
  const error = params.get('error');
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [err, setErr] = useState(error ? `Google connection failed (${error}). Try again.` : null);

  useEffect(() => {
    if (pick) {
      api(`google-customers?connection_id=${pick}`)
        .then((d) => setCustomers(d.customers))
        .catch((e) => setErr(e.message));
    }
  }, [pick]);

  const connect = async () => {
    setBusy(true); setErr(null);
    try {
      const { url } = await api('google-oauth-start');
      window.location.href = url;
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  const finalize = async () => {
    setBusy(true); setErr(null);
    try {
      const c = customers.find((x) => x.id === chosen);
      await api('google-select-customer', { method: 'POST', body: { connection_id: pick, customer_id: chosen, name: c?.name } });
      navigate('/dashboard?connected=1');
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>Connect your Google Ads</h1>
      <p className="muted">
        Clarify reads your account nightly — campaigns, keywords, search terms — and turns it into
        plain-English answers. Read-only. We never change anything in your account.
      </p>
      {err && <div className="banner warn">{err}</div>}

      {!pick && (
        <div className="section">
          <h3>What happens next</h3>
          <p className="muted">You'll approve read access with Google, we'll pull your last 30 days, and your first audit will be ready in a couple of minutes.</p>
          <button className="btn primary" disabled={busy} onClick={connect}>
            {busy ? 'Opening Google…' : 'Connect Google Ads'}
          </button>
        </div>
      )}

      {pick && !customers && !err && <Spinner label="Fetching your accounts from Google…" />}

      {pick && customers && (
        <div className="section">
          <h3>Which account is yours?</h3>
          <p className="muted">Your Google login can see several Ads accounts. Pick the one Clarify should watch.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
            {customers.map((c) => (
              <label key={c.id} className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', padding: 12 }}>
                <input type="radio" name="cid" style={{ width: 'auto' }} checked={chosen === c.id} onChange={() => setChosen(c.id)} />
                <span><strong>{c.name}</strong> <span className="faint mono">({c.id})</span></span>
              </label>
            ))}
          </div>
          <button className="btn primary" disabled={!chosen || busy} onClick={finalize}>
            {busy ? 'Saving…' : 'Use this account'}
          </button>
        </div>
      )}
    </div>
  );
}
