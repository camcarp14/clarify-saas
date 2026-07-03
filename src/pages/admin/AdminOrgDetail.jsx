import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Spinner, Chip, Pill } from '../../components/ui';
import { timeAgo } from '../../lib/format';
import { PRICE, TIERS, usd0, riskFor, RiskChips } from './shared';

// The core of the console: everything about one workspace, and every lever you can
// pull on it. All levers call admin-org-actions / admin-stripe server-side — nothing
// here writes another org's rows from the browser. Every action lands in audit_log.
export default function AdminOrgDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { startViewAs } = useAuth();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [invoices, setInvoices] = useState(null);

  const load = useCallback(async () => {
    const [org, profiles, conns, comms, audits, alerts, leads, overdue, snaps] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', id).single(),
      supabase.from('profiles').select('*').eq('org_id', id).order('created_at'),
      supabase.from('google_ads_connections').select('*').eq('org_id', id).order('created_at'),
      supabase.from('comms_connections').select('*').eq('org_id', id).order('created_at'),
      supabase.from('audits').select('*').eq('org_id', id).order('created_at', { ascending: false }).limit(8),
      supabase.from('alerts').select('*').eq('org_id', id).order('triggered_at', { ascending: false }).limit(8),
      supabase.from('leads').select('status').eq('org_id', id),
      supabase.from('enrollments').select('id, next_run_at').eq('org_id', id).eq('status', 'active')
        .lt('next_run_at', new Date(Date.now() - 30 * 60000).toISOString()),
      supabase.from('account_snapshots').select('connection_id, structure, synced_at').eq('org_id', id)
        .order('synced_at', { ascending: false }).limit(10),
    ]);
    if (!org.data) { setD({ missing: true }); return; }
    const snapByConn = {};
    for (const s of snaps.data || []) if (!snapByConn[s.connection_id]) snapByConn[s.connection_id] = s;
    const leadCounts = (leads.data || []).reduce((m, l) => ((m[l.status] = (m[l.status] || 0) + 1), m), {});
    setD({
      org: org.data, profiles: profiles.data || [], conns: conns.data || [], comms: comms.data || [],
      audits: audits.data || [], alerts: alerts.data || [], leadCounts,
      leadsTotal: (leads.data || []).length, overdue: (overdue.data || []).length, snapByConn,
    });
    setNotesDraft(org.data.internal_notes || '');
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api(`admin-stripe?org_id=${id}`).then((r) => setInvoices(r.invoices || [])).catch(() => setInvoices([]));
  }, [id]);

  const act = async (action, payload = {}, label = action) => {
    setBusy(label); setNote(null);
    try {
      await api('admin-org-actions', { method: 'POST', body: { action, org_id: id, ...payload } });
      setNote({ ok: true, text: 'Done — logged to the audit trail.' });
      await load();
    } catch (e) { setNote({ ok: false, text: e.message }); }
    setBusy('');
  };

  if (!d) return <Spinner />;
  if (d.missing) return <div className="section"><h2>Workspace not found</h2><Link to="/admin/orgs">← Back to directory</Link></div>;

  const { org, profiles } = d;
  const owner = profiles.find((p) => p.role === 'owner') || profiles[0];
  const lastSeen = profiles.map((p) => p.last_seen_at).filter(Boolean).sort().pop() || null;
  const trialDays = org.trial_ends_at ? Math.ceil((new Date(org.trial_ends_at) - Date.now()) / 86400000) : null;
  const mrr = org.subscription_status === 'active' ? PRICE[org.plan_tier] || 0 : 0;
  const risks = riskFor(org, { lastSeen, conns: d.conns, criticals: [] });

  return (
    <div>
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <Link to="/admin/orgs" className="faint">← Organizations</Link>
          <h1 style={{ marginTop: 4 }}>{org.name}</h1>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <Pill v={org.suspended_at ? 'error' : org.subscription_status} />
            <span className="chip pass" style={{ textTransform: 'capitalize' }}>{org.plan_tier}</span>
            <RiskChips risks={risks} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={async () => { await startViewAs(org.id, org.name); navigate('/dashboard'); }}>View as customer</button>
        </div>
      </div>

      {note && <div className={`banner ${note.ok ? 'trial' : 'warn'}`} style={{ marginTop: 12 }}>{note.text}</div>}

      {/* ── Overview ── */}
      <div className="grid" style={{ marginTop: 14 }}>
        <div className="card"><div className="label">MRR</div><div className="big">{usd0(mrr)}</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>{org.subscription_status === 'active' ? `${org.plan_tier} plan` : 'not paying yet'}</p></div>
        <div className="card"><div className="label">Signed up</div><div className="big">{timeAgo(org.created_at)}</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>{owner?.email || '—'}</p></div>
        <div className="card"><div className="label">Trial</div>
          <div className="big">{org.subscription_status === 'trialing' ? (trialDays < 0 ? 'expired' : `${trialDays}d left`) : '—'}</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>ends {org.trial_ends_at ? new Date(org.trial_ends_at).toLocaleDateString() : '—'}</p></div>
        <div className="card"><div className="label">Discovery credits</div>
          <div className="big">{Math.max(0, (org.monthly_credits || 0) - (org.credits_used || 0))}</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>{org.credits_used || 0} used of {org.monthly_credits || 0} · period started {timeAgo(org.period_started_at)}</p></div>
      </div>

      {/* ── Billing controls ── */}
      <div className="section">
        <div className="row-between">
          <h2>Billing controls</h2>
          {org.stripe_customer_id && (
            <a className="btn small ghost" style={{ textDecoration: 'none' }} target="_blank" rel="noreferrer"
              href={`https://dashboard.stripe.com/customers/${org.stripe_customer_id}`}>Open in Stripe ↗</a>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          <label className="faint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Plan
            <select style={{ width: 'auto' }} value={org.plan_tier} disabled={!!busy}
              onChange={(e) => { if (confirm(`Change plan to ${e.target.value}? This bypasses Stripe and re-maps their credit allowance.`)) act('plan_change', { tier: e.target.value }); }}>
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <button className="btn small ghost" disabled={!!busy} onClick={() => {
            const n = parseInt(prompt('Grant how many bonus discovery credits?'), 10);
            if (n) act('credit_grant', { credits: n });
          }}>+ Grant credits</button>
          <button className="btn small ghost" disabled={!!busy} onClick={() => confirm('Reset their credit period? credits_used goes to 0.') && act('credit_reset')}>Reset credit period</button>
          <button className="btn small ghost" disabled={!!busy} onClick={() => act('trial_extend', { days: 7 })}>Extend trial +7d</button>
          <button className="btn small ghost" disabled={!!busy} onClick={() => act('trial_extend', { days: 14 })}>+14d</button>
        </div>
        <div style={{ marginTop: 16 }}>
          <h3>Recent invoices</h3>
          {invoices === null ? <Spinner /> : invoices.length === 0 ? <p className="muted">None on file.</p> : (
            <table className="plain" style={{ marginTop: 6 }}>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="mono" style={{ fontSize: 12 }}>{i.number || i.id.slice(0, 14)}</td>
                    <td style={{ textTransform: 'capitalize' }}>{i.status}</td>
                    <td className="mono">{usd0((i.amount_paid || i.amount_due) / 100)}</td>
                    <td className="faint">{timeAgo(new Date(i.created * 1000).toISOString())}</td>
                    <td>{i.hosted_invoice_url && <a href={i.hosted_invoice_url} target="_blank" rel="noreferrer">view ↗</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Google Ads connections ── */}
      <div className="section">
        <h2>Google Ads connections</h2>
        {d.conns.length === 0 && <p className="muted">None connected.</p>}
        {d.conns.map((c) => {
          const snap = d.snapByConn[c.id];
          return (
            <div key={c.id} style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
              <div className="row-between">
                <div>
                  <strong>{c.descriptive_name || 'Unnamed account'}</strong>
                  <span className="faint mono" style={{ marginLeft: 8, fontSize: 12 }}>{c.customer_id || 'pending'}</span>
                  <span style={{ marginLeft: 8 }}><Pill v={c.status} /></span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {c.status === 'active' && (
                    <>
                      <button className="btn small ghost" disabled={!!busy} onClick={() => act('resync', { connection_id: c.id }, 'resync')}>{busy === 'resync' ? 'Kicking…' : 'Re-sync now'}</button>
                      <button className="btn small ghost" disabled={!!busy} onClick={async () => {
                        setBusy('audit'); setNote(null);
                        try { await api('run-audit', { method: 'POST', body: { connection_id: c.id } }); setNote({ ok: true, text: 'Audit ran — logged.' }); await load(); }
                        catch (e) { setNote({ ok: false, text: e.message }); }
                        setBusy('');
                      }}>{busy === 'audit' ? 'Auditing…' : 'Run audit'}</button>
                    </>
                  )}
                  {c.status !== 'revoked' && (
                    <button className="btn small ghost" disabled={!!busy} onClick={() => confirm('Revoke this connection? Syncs stop until they reconnect.') && act('revoke_ads_connection', { connection_id: c.id })}>Revoke</button>
                  )}
                </div>
              </div>
              <div className="faint" style={{ marginTop: 4 }}>
                synced {timeAgo(c.last_synced_at)}{c.last_sync_error ? ` · error: ${c.last_sync_error.slice(0, 90)}` : ''}
              </div>
              {snap && (
                <div className="faint mono" style={{ marginTop: 4, fontSize: 11.5 }}>
                  structure @ {timeAgo(snap.synced_at)}: {Object.entries(snap.structure || {}).slice(0, 6).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v).slice(0, 20) : v}`).join(' · ')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Outreach connections ── */}
      <div className="section">
        <h2>Outreach connections</h2>
        {d.comms.length === 0 && <p className="muted">No mailboxes or SMS connected.</p>}
        {d.comms.map((c) => (
          <div key={c.id} className="row-between" style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
            <div>
              <strong className="mono" style={{ fontSize: 13 }}>{c.address}</strong>
              <div className="faint">{c.kind.replace('_', '/')} · {c.daily_send_cap}/day cap · {c.last_synced_at ? `synced ${timeAgo(c.last_synced_at)}` : 'never synced'}
                {c.last_error ? ` · ${c.last_error.slice(0, 60)}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Pill v={c.status} />
              {c.status !== 'revoked' && <button className="btn small ghost" disabled={!!busy} onClick={() => confirm('Revoke this connection?') && act('revoke_comms_connection', { connection_id: c.id })}>Revoke</button>}
            </div>
          </div>
        ))}
      </div>

      {/* ── Audits & alerts ── */}
      <div className="section">
        <h2>Audits & alerts</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <h3>Recent audits</h3>
            {d.audits.length === 0 && <p className="muted">None yet.</p>}
            {d.audits.map((a) => (
              <div key={a.id} className="row-between" style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
                <span>score <strong>{a.score ?? '—'}</strong> <span className="faint">({a.status})</span></span>
                <span className="faint">{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
          <div>
            <h3>Recent alerts</h3>
            {d.alerts.length === 0 && <p className="muted">None yet.</p>}
            {d.alerts.map((a) => (
              <div key={a.id} className="row-between" style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
                <span><Chip severity={a.severity} /> <span style={{ marginLeft: 6 }}>{a.title}</span></span>
                <span className="faint">{a.acknowledged_at ? 'acked' : 'open'} · {timeAgo(a.triggered_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Pipeline snapshot ── */}
      <div className="section">
        <h2>Outreach pipeline</h2>
        {d.leadsTotal === 0 ? <p className="muted">No leads yet — outreach module unused so far.</p> : (
          <p className="muted">
            {d.leadsTotal} leads · {Object.entries(d.leadCounts).map(([s, n]) => `${n} ${s.replace('_', ' ')}`).join(' · ')}
            {d.overdue > 0 && <span style={{ color: 'var(--act)' }}> · {d.overdue} enrollment{d.overdue === 1 ? '' : 's'} overdue — engine may be stuck for them</span>}
          </p>
        )}
      </div>

      {/* ── Users ── */}
      <div className="section">
        <h2>Users</h2>
        <table className="plain">
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id}>
                <td>{p.email}<div className="faint">{p.full_name || ''}</div></td>
                <td>
                  <select style={{ width: 'auto' }} value={p.role} disabled={!!busy || p.is_clarify_admin}
                    onChange={(e) => act('role_change', { profile_id: p.id, role: e.target.value })}>
                    <option value="owner">owner</option><option value="member">member</option>
                  </select>
                  {p.is_clarify_admin && <span className="chip pass" style={{ marginLeft: 6 }}>clarify admin</span>}
                </td>
                <td className="faint">last seen {timeAgo(p.last_seen_at)}</td>
                <td style={{ textAlign: 'right' }}>
                  {!p.is_clarify_admin && (
                    <button className="btn small ghost" disabled={!!busy}
                      onClick={() => confirm(`Remove ${p.email} from this workspace? Their login remains but loses access (profiles row only — see notes).`) && act('remove_user', { profile_id: p.id })}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Internal notes ── */}
      <div className="section">
        <h2>Internal notes</h2>
        <p className="muted">Only admins ever see this. Context on the account, follow-ups, anything.</p>
        <textarea rows={4} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="e.g. Comped growth plan through Q3 — friend of a friend, check in mid-September." />
        <button className="btn" style={{ marginTop: 8 }} disabled={!!busy || notesDraft === (org.internal_notes || '')}
          onClick={() => act('notes_update', { notes: notesDraft })}>Save notes</button>
      </div>

      {/* ── Danger zone ── */}
      <DangerZone org={org} busy={busy} act={act} onCanceled={load} setNote={setNote} navigate={navigate} />
    </div>
  );
}

// Typed-confirmation danger zone — friction proportional to irreversibility.
function DangerZone({ org, busy, act, onCanceled, setNote, navigate }) {
  const [confirmFor, setConfirmFor] = useState(null); // 'suspend' | 'cancel' | 'delete'
  const [typed, setTyped] = useState('');
  const armed = typed === org.name;

  const cancelStripe = async () => {
    try {
      await api('admin-stripe', { method: 'POST', body: { action: 'cancel_subscription', org_id: org.id } });
      setNote({ ok: true, text: 'Subscription canceled at Stripe — logged.' });
      setConfirmFor(null); setTyped('');
      onCanceled();
    } catch (e) { setNote({ ok: false, text: e.message }); }
  };
  const deleteOrg = async () => {
    await act('delete_org', {}, 'delete');
    navigate('/admin/orgs');
  };

  const Item = ({ id, title, desc, cta, onGo, disabled, disabledWhy }) => (
    <div className="row-between" style={{ padding: '12px 0', borderBottom: '1px solid rgba(200,74,58,0.15)', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ maxWidth: 520 }}>
        <strong>{title}</strong>
        <p className="muted" style={{ margin: '3px 0 0' }}>{desc}</p>
        {disabled && disabledWhy && <p style={{ margin: '3px 0 0', color: 'var(--act)', fontSize: 13 }}>{disabledWhy}</p>}
      </div>
      {confirmFor === id ? (
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input placeholder={`Type "${org.name}" to confirm`} style={{ width: 220 }} value={typed} onChange={(e) => setTyped(e.target.value)} />
          <button className="btn small" style={{ background: 'var(--act)', color: '#fff', border: 'none' }} disabled={!armed || !!busy} onClick={onGo}>{cta}</button>
          <button className="btn small ghost" onClick={() => { setConfirmFor(null); setTyped(''); }}>Never mind</button>
        </span>
      ) : (
        <button className="btn small ghost" style={{ color: 'var(--act)', borderColor: 'rgba(200,74,58,0.4)' }} disabled={disabled || !!busy}
          onClick={() => { setConfirmFor(id); setTyped(''); }}>{cta}</button>
      )}
    </div>
  );

  return (
    <div className="section danger-zone">
      <h2 style={{ color: 'var(--act)' }}>Danger zone</h2>
      <p className="muted">Each of these requires typing the workspace name, and each writes its own audit-trail entry.</p>
      {org.suspended_at ? (
        <div className="row-between" style={{ padding: '12px 0', borderBottom: '1px solid rgba(200,74,58,0.15)' }}>
          <div><strong>Suspended {timeAgo(org.suspended_at)}</strong><p className="muted" style={{ margin: '3px 0 0' }}>They see a suspension screen at login.</p></div>
          <button className="btn small ghost" disabled={!!busy} onClick={() => act('unsuspend')}>Lift suspension</button>
        </div>
      ) : (
        <Item id="suspend" title="Suspend workspace" cta="Suspend"
          desc="Blocks the app at login with a suspension notice. Reversible — their data is untouched."
          onGo={async () => { await act('suspend'); setConfirmFor(null); setTyped(''); }} />
      )}
      <Item id="cancel" title="Cancel Stripe subscription" cta="Cancel subscription"
        desc="Cancels immediately at Stripe and marks the workspace canceled here."
        disabled={!org.stripe_subscription_id} disabledWhy={!org.stripe_subscription_id ? 'No Stripe subscription on file.' : null}
        onGo={cancelStripe} />
      <Item id="delete" title="Delete workspace permanently" cta="Delete forever"
        desc="Hard-deletes the org and every row that cascades from it — connections, metrics, audits, leads, messages. There is no undo."
        disabled={org.subscription_status === 'active' && !!org.stripe_subscription_id}
        disabledWhy={org.subscription_status === 'active' && org.stripe_subscription_id ? 'Active subscription — cancel it first.' : null}
        onGo={deleteOrg} />
    </div>
  );
}
