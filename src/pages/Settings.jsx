import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { timeAgo } from '../lib/format';
import { Spinner, Pill } from '../components/ui';

// One bundled subscription now covers both the Ads audit AND outreach — same 3 price ids,
// each tier gates ad-spend/account limits, mailbox/channel access, and discovery credits together.
const TIERS = [
  { id: 'starter', name: 'Starter', price: '$149/mo', spend: 'Up to $5k/mo ad spend · 1 account · nightly sync', outreach: '1 mailbox · email sequences · 300 discovery credits/mo' },
  { id: 'growth', name: 'Growth', price: '$399/mo', spend: 'Up to $25k/mo ad spend · 2 accounts · daily sync', outreach: '3 mailboxes · + LinkedIn assisted · 1,000 credits/mo' },
  { id: 'pro', name: 'Pro', price: '$699/mo', spend: 'Up to $75k/mo ad spend · 5 accounts · hourly sync', outreach: 'Unlimited mailboxes · + SMS (consented) · 3,000 credits/mo' },
];

export default function Settings() {
  const { org, profile, supportView, refreshOrg } = useAuth();
  const [params] = useSearchParams();
  const [conns, setConns] = useState(null);
  const [outreachConns, setOutreachConns] = useState(null);
  const [prop, setProp] = useState(undefined);
  const [gsc, setGsc] = useState(undefined);
  const [showSmtp, setShowSmtp] = useState(false);
  const [showSms, setShowSms] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [orgName, setOrgName] = useState('');
  const [mailing, setMailing] = useState('');
  const [savedBiz, setSavedBiz] = useState(false);
  const checkout = params.get('checkout');

  useEffect(() => {
    if (org) { setOrgName(org.name || ''); setMailing(org.mailing_address || ''); }
  }, [org?.id, org?.mailing_address]); // eslint-disable-line

  const saveBiz = async () => {
    const { error } = await supabase.from('organizations')
      .update({ name: orgName, mailing_address: mailing }).eq('id', org.id);
    if (error) { setErr('Only the workspace owner can edit business details.'); return; }
    setSavedBiz(true); setTimeout(() => setSavedBiz(false), 2200);
    refreshOrg();
  };

  useEffect(() => { if (checkout === 'success' || params.get('connected')) refreshOrg(); }, [checkout]); // eslint-disable-line

  useEffect(() => {
    if (!org?.id) return;
    supabase.from('google_ads_connections').select('*').eq('org_id', org.id).order('created_at')
      .then(({ data }) => setConns(data || []));
    supabase.from('organic_properties').select('*').eq('org_id', org.id).order('created_at').limit(1)
      .then(({ data }) => setProp(data?.[0] || null));
    supabase.from('gsc_connections').select('*').eq('org_id', org.id).neq('status', 'revoked')
      .order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => setGsc(data?.[0] || null));
  }, [org?.id]);

  const loadOutreachConns = () => {
    if (!org?.id) return;
    supabase.from('comms_connections').select('*').eq('org_id', org.id).order('created_at')
      .then(({ data }) => setOutreachConns(data || []));
  };
  useEffect(loadOutreachConns, [org?.id]);

  const oauth = async (fn) => {
    setBusy(fn);
    try { const { url } = await api(fn); window.location.href = url; }
    catch (e) { setErr(e.message); setBusy(null); }
  };
  const disconnectOutreach = async (id) => {
    if (!confirm('Disconnect this? Sequences using it will pause at their next send.')) return;
    await supabase.from('comms_connections').update({ status: 'revoked' }).eq('id', id);
    loadOutreachConns();
  };

  const choose = async (tier) => {
    setBusy(tier); setErr(null);
    try {
      const { url } = await api('stripe-create-checkout', { method: 'POST', body: { tier } });
      window.location.href = url;
    } catch (e) { setErr(e.message); setBusy(null); }
  };

  const portal = async () => {
    setBusy('portal'); setErr(null);
    try {
      const { url } = await api('stripe-portal', { method: 'POST' });
      window.location.href = url;
    } catch (e) { setErr(e.message); setBusy(null); }
  };

  const disconnect = async (c) => {
    if (!confirm(`Disconnect ${c.descriptive_name || c.customer_id}? Synced data for it will be removed.`)) return;
    const { error } = await supabase.from('google_ads_connections').delete().eq('id', c.id);
    if (error) setErr('Only the workspace owner can disconnect accounts.');
    else setConns((all) => all.filter((x) => x.id !== c.id));
  };

  if (!org) return <Spinner />;
  const isOwner = profile?.role === 'owner';

  return (
    <div>
      <h1>Settings & billing</h1>
      {checkout === 'success' && <div className="banner trial">You're in. Syncs run on your new plan's cadence starting now.</div>}
      {checkout === 'canceled' && <div className="banner warn">Checkout canceled — no changes made.</div>}
      {err && <div className="banner warn">{err}</div>}

      <div className="section">
        <div className="row-between">
          <div>
            <h2>{org.name}</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Plan: <strong style={{ textTransform: 'capitalize' }}>{org.plan_tier}</strong> · Status:{' '}
              <strong style={{ textTransform: 'capitalize' }}>{org.subscription_status.replace('_', ' ')}</strong>
            </p>
          </div>
          {org.stripe_customer_id && (
            <button className="btn ghost" disabled={busy === 'portal' || supportView} onClick={portal}>
              {busy === 'portal' ? 'Opening…' : 'Manage billing'}
            </button>
          )}
        </div>
      </div>

      <div className="section">
        <h2>Business details</h2>
        <p className="muted" style={{ margin: '4px 0 12px' }}>
          The mailing address goes in the footer of every outreach email — CAN-SPAM requires it,
          and sequences won't send email without it.
        </p>
        <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
          <label>Business name<input value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!isOwner || supportView} /></label>
          <label>Mailing address
            <input placeholder="123 W Example St, Suite 4, Chicago, IL 60614" value={mailing}
              onChange={(e) => setMailing(e.target.value)} disabled={!isOwner || supportView} />
          </label>
          {!mailing && <div className="banner warn" style={{ margin: 0 }}>No mailing address yet — email sequences will pause at their first send until this is filled in.</div>}
          {isOwner && !supportView && (
            <div><button className="btn" onClick={saveBiz}>{savedBiz ? 'Saved ✓' : 'Save details'}</button></div>
          )}
        </div>
      </div>

      <div className="grid">
        {TIERS.map((t) => {
          const current = org.plan_tier === t.id && org.subscription_status === 'active';
          return (
            <div key={t.id} className="card" style={current ? { borderColor: 'var(--clarity)' } : {}}>
              <div className="row-between"><h3>{t.name}</h3><span className="mono">{t.price}</span></div>
              <p className="muted" style={{ margin: '8px 0 4px' }}>{t.spend}</p>
              <p className="muted" style={{ margin: '0 0 8px' }}>{t.outreach}</p>
              <button className="btn primary" style={{ width: '100%' }}
                disabled={current || busy === t.id || supportView}
                onClick={() => choose(t.id)}>
                {current ? 'Current plan' : busy === t.id ? 'Opening checkout…' : 'Choose ' + t.name}
              </button>
            </div>
          );
        })}
      </div>
      <p className="faint">Spending more than $75k/mo? <a href="mailto:cameron@clarifypaidsearch.com">Talk to us</a> — that's the tier where we work your account with you.</p>

      <div className="section">
        <div className="row-between">
          <h2>Organic search sources</h2>
          <Link to="/audit?tab=organic" className="btn small ghost" style={{ textDecoration: 'none' }}>Open organic audit</Link>
        </div>
        <div className="card row-between" style={{ marginTop: 10 }}>
          <div>
            <strong>Site crawl</strong>
            <div className="faint">
              {prop === undefined ? 'Checking…'
                : !prop ? 'No site yet — add one from the Audit page\u2019s Organic tab.'
                : `${prop.site_url.replace(/^https?:\/\//, '')} · ${prop.status === 'ready' ? `${prop.pages_crawled} pages, crawled ${timeAgo(prop.last_crawled_at)}` : prop.status}`}
            </div>
          </div>
          {prop && <Pill v={prop.status} />}
        </div>
        <div className="card row-between" style={{ marginTop: 10 }}>
          <div>
            <strong>Google Search Console</strong>
            <div className="faint">
              {gsc === undefined ? 'Checking…'
                : !gsc ? 'Not connected — real queries, positions, and the overlap view need this.'
                : `${gsc.site_url || 'no property picked'} · ${gsc.status === 'active' ? `synced ${timeAgo(gsc.last_synced_at)}` : (gsc.status_detail || gsc.status)}`}
            </div>
          </div>
          {gsc === null
            ? <button className="btn small org" disabled={busy === 'google-oauth-start?product=gsc' || supportView} onClick={() => oauth('google-oauth-start?product=gsc')}>
                {busy === 'google-oauth-start?product=gsc' ? 'Redirecting…' : 'Connect'}
              </button>
            : gsc && <Pill v={gsc.status} />}
        </div>
      </div>

      <div className="section">
        <div className="row-between">
          <h2>Connected Google Ads accounts</h2>
          <Link to="/onboarding" className="btn small ghost" style={{ textDecoration: 'none' }}>Connect another</Link>
        </div>
        {conns === null ? <Spinner /> : !conns.length ? (
          <p className="muted">None yet. <Link to="/onboarding">Connect one →</Link></p>
        ) : conns.map((c) => (
          <div key={c.id} className="card row-between" style={{ marginTop: 10 }}>
            <div>
              <strong>{c.descriptive_name || c.customer_id}</strong>{' '}
              <span className="faint mono">{c.customer_id}</span>
              <div className="faint">
                {c.status === 'active' ? `synced ${timeAgo(c.last_synced_at)}` : c.status.replace('_', ' ')}
                {c.last_sync_error ? ` — ${c.last_sync_error.slice(0, 80)}` : ''}
              </div>
            </div>
            {isOwner && !supportView && (
              <button className="btn small ghost" onClick={() => disconnect(c)}>Disconnect</button>
            )}
          </div>
        ))}
      </div>

      <div className="section">
        <div className="row-between">
          <h2>Outreach — connected mailboxes</h2>
          <span className="faint mono">{Math.max(0, (org.monthly_credits || 0) - (org.credits_used || 0))} discovery credits left</span>
        </div>
        <p className="muted" style={{ margin: '4px 0 12px' }}>Your inboxes, your domain reputation — sends respect each mailbox's daily cap and warm-up ramp.</p>
        {params.get('connect_error') && <div className="banner warn">Couldn't connect: {params.get('connect_error')}. Try again and grant both send and read access.</div>}
        {params.get('connected') && <div className="banner trial">Connected {params.get('connected')} — it can send and receive now.</div>}
        {outreachConns === null ? <Spinner /> : outreachConns.map((c) => (
          <div key={c.id} className="row-between" style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
            <div>
              <strong className="mono" style={{ fontSize: 13.5 }}>{c.address}</strong>
              <div className="faint">{c.kind.replace('_', '/')} · {c.last_synced_at ? `synced ${timeAgo(c.last_synced_at)}` : 'never synced'}
                {c.kind !== 'sms_twilio' ? ` · ${c.daily_send_cap}/day cap` : ''}
                {c.last_error ? ` · ${c.last_error.slice(0, 60)}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Pill v={c.status} />
              {isOwner && !supportView && c.status !== 'revoked' && <button className="btn small ghost" onClick={() => disconnectOutreach(c.id)}>Disconnect</button>}
            </div>
          </div>
        ))}
        {isOwner && !supportView && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn ghost" disabled={!!busy} onClick={() => oauth('gmail-oauth-start')}>Connect Gmail</button>
            <button className="btn ghost" disabled={!!busy} onClick={() => oauth('outlook-oauth-start')}>Connect Outlook</button>
            <button className="btn ghost" onClick={() => setShowSmtp(!showSmtp)}>Other email (IMAP/SMTP)</button>
            <button className="btn ghost" onClick={() => setShowSms(!showSms)}>SMS via Twilio {org.plan_tier !== 'pro' && '— Pro'}</button>
          </div>
        )}
        {showSmtp && <SmtpForm onDone={() => { setShowSmtp(false); loadOutreachConns(); }} />}
        {showSms && <SmsForm onDone={() => { setShowSms(false); loadOutreachConns(); }} />}
      </div>
    </div>
  );
}

function SmtpForm({ onDone }) {
  const [f, setF] = useState({ address: '', smtp_host: '', smtp_port: 587, imap_host: '', imap_port: 993, username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await api('connect-smtp', { method: 'POST', body: f }); onDone(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="section" style={{ marginTop: 12 }}>
      <h3>Any other inbox</h3>
      <p className="muted">Works with any provider. Most require an app-specific password rather than your real one. We test both send and receive before saving.</p>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
        <label>Email address<input value={f.address} onChange={set('address')} placeholder="you@yourdomain.com" /></label>
        <label>Username<input value={f.username} onChange={set('username')} placeholder="usually the same email" /></label>
        <label>SMTP host<input value={f.smtp_host} onChange={set('smtp_host')} placeholder="smtp.yourhost.com" /></label>
        <label>SMTP port<input type="number" value={f.smtp_port} onChange={set('smtp_port')} /></label>
        <label>IMAP host<input value={f.imap_host} onChange={set('imap_host')} placeholder="imap.yourhost.com" /></label>
        <label>IMAP port<input type="number" value={f.imap_port} onChange={set('imap_port')} /></label>
        <label style={{ gridColumn: '1 / -1' }}>App password<input type="password" value={f.password} onChange={set('password')} /></label>
      </div>
      {err && <div className="banner warn" style={{ marginTop: 10 }}>{err}</div>}
      <button className="btn primary" style={{ marginTop: 10 }} disabled={busy} onClick={submit}>{busy ? 'Testing connection…' : 'Verify & connect'}</button>
    </div>
  );
}

function SmsForm({ onDone }) {
  const [f, setF] = useState({ account_sid: '', auth_token: '', from_number: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('connect-sms', { method: 'POST', body: f });
      if (r.note) alert(r.note);
      onDone();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="section" style={{ marginTop: 12 }}>
      <h3>SMS via your Twilio account</h3>
      <p className="muted">
        Texts only send to leads with a recorded consent entry — enforced at send time, not just in the UI.
        Your Twilio number must have finished A2P 10DLC registration or US carriers will silently block it.
      </p>
      <div style={{ display: 'grid', gap: 10, marginTop: 8, maxWidth: 440 }}>
        <label>Account SID<input value={f.account_sid} onChange={set('account_sid')} placeholder="AC…" /></label>
        <label>Auth token<input type="password" value={f.auth_token} onChange={set('auth_token')} /></label>
        <label>Sending number<input value={f.from_number} onChange={set('from_number')} placeholder="+13125551234" /></label>
      </div>
      {err && <div className="banner warn" style={{ marginTop: 10 }}>{err}</div>}
      <button className="btn primary" style={{ marginTop: 10 }} disabled={busy} onClick={submit}>{busy ? 'Verifying…' : 'Verify & connect'}</button>
    </div>
  );
}
