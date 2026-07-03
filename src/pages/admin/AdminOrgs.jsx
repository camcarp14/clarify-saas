import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Spinner } from '../../components/ui';
import { timeAgo } from '../../lib/format';
import { TIERS, riskFor, RiskChips } from './shared';

const PAGE = 25;

// The directory. Search is intent-aware: "@" searches owner emails, "cus_" searches
// Stripe customer ids, anything else searches workspace names.
export default function AdminOrgs() {
  const { startViewAs } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const [sel, setSel] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState('');

  const load = useCallback(async () => {
    setRows(null);
    let query = supabase.from('organizations').select('*', { count: 'exact' });

    if (q.trim()) {
      const term = q.trim();
      if (term.includes('@')) {
        const { data: ps } = await supabase.from('profiles').select('org_id').ilike('email', `%${term}%`).limit(200);
        const ids = [...new Set((ps || []).map((p) => p.org_id))];
        if (!ids.length) { setRows([]); setTotal(0); return; }
        query = query.in('id', ids);
      } else if (term.startsWith('cus_')) {
        query = query.ilike('stripe_customer_id', `%${term}%`);
      } else {
        query = query.ilike('name', `%${term}%`);
      }
    }
    if (tier !== 'all') query = query.eq('plan_tier', tier);
    if (status !== 'all') query = status === 'suspended' ? query.not('suspended_at', 'is', null) : query.eq('subscription_status', status);

    if (sort === 'name') query = query.order('name');
    else if (sort === 'plan') query = query.order('plan_tier').order('created_at', { ascending: false });
    else if (sort === 'status') query = query.order('subscription_status').order('created_at', { ascending: false });
    else query = query.order('created_at', { ascending: false });

    const { data: orgs, count } = await query.range(page * PAGE, page * PAGE + PAGE - 1);
    setTotal(count || 0);
    const ids = (orgs || []).map((o) => o.id);
    if (!ids.length) { setRows([]); return; }

    // Related data for just this page's orgs — keeps the directory fast at any scale.
    const [profiles, conns, criticals, alerts, leads] = await Promise.all([
      supabase.from('profiles').select('org_id, email, role, last_seen_at').in('org_id', ids),
      supabase.from('google_ads_connections').select('org_id, status, last_synced_at').in('org_id', ids),
      supabase.from('audit_findings').select('org_id, category').eq('status', 'open').eq('severity', 'critical').in('org_id', ids),
      supabase.from('alerts').select('org_id').is('acknowledged_at', null).in('org_id', ids),
      supabase.from('leads').select('org_id, status').in('org_id', ids),
    ]);
    const by = (arr, key) => (arr.data || []).reduce((m, x) => ((m[x[key]] ||= []).push(x), m), {});
    const pBy = by(profiles, 'org_id'), cBy = by(conns, 'org_id'), fBy = by(criticals, 'org_id'),
          aBy = by(alerts, 'org_id'), lBy = by(leads, 'org_id');

    setRows((orgs || []).map((o) => {
      const ps = pBy[o.id] || [], cs = cBy[o.id] || [];
      const owner = ps.find((p) => p.role === 'owner') || ps[0];
      const lastSeen = ps.map((p) => p.last_seen_at).filter(Boolean).sort().pop() || null;
      const lastSync = cs.map((c) => c.last_synced_at).filter(Boolean).sort().pop() || null;
      const leadRows = lBy[o.id] || [];
      return {
        org: o, owner: owner?.email || '—', lastSeen, lastSync,
        connCount: cs.filter((c) => c.status === 'active').length,
        openCriticals: (fBy[o.id] || []).length,
        unackAlerts: (aBy[o.id] || []).length,
        leads: leadRows.length,
        replied: leadRows.filter((l) => l.status === 'replied').length,
        risks: riskFor(o, { lastSeen, conns: cs, criticals: fBy[o.id] || [] }),
      };
    }));
  }, [q, tier, status, sort, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [q, tier, status, sort]);

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const bulk = async (label, run) => {
    if (!sel.size) return;
    if (!confirm(`${label} for ${sel.size} workspace${sel.size === 1 ? '' : 's'}?`)) return;
    setBulkBusy(label);
    let done = 0;
    for (const id of sel) {
      try { await run(id); done++; } catch (e) { alert(`Failed on one org: ${e.message}`); break; }
      setBulkBusy(`${label} ${done}/${sel.size}`);
    }
    setBulkBusy(''); setSel(new Set()); load();
  };
  const bulkTier = (t) => bulk(`Set plan → ${t}`, (id) => api('admin-org-actions', { method: 'POST', body: { action: 'plan_change', org_id: id, tier: t } }));
  const bulkCredits = () => {
    const n = parseInt(prompt('Grant how many bonus discovery credits to each selected workspace?'), 10);
    if (!n) return;
    bulk(`Grant ${n} credits`, (id) => api('admin-org-actions', { method: 'POST', body: { action: 'credit_grant', org_id: id, credits: n } }));
  };

  return (
    <div>
      <div className="row-between">
        <h1>Organizations</h1>
        <input placeholder="Search name, owner@email, or cus_…" style={{ maxWidth: 300 }} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ width: 'auto' }} value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="all">All plans</option>{TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {['trialing', 'active', 'past_due', 'canceled', 'suspended'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest first</option><option value="name">Name A–Z</option>
          <option value="plan">By plan</option><option value="status">By status</option>
        </select>
        <span className="faint" style={{ marginLeft: 'auto' }}>{total} workspace{total === 1 ? '' : 's'}</span>
      </div>

      {sel.size > 0 && (
        <div className="banner info" style={{ marginBottom: 12 }}>
          <span><strong>{sel.size}</strong> selected{bulkBusy && ` — ${bulkBusy}…`}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            {TIERS.map((t) => <button key={t} className="btn small ghost" disabled={!!bulkBusy} onClick={() => bulkTier(t)}>→ {t}</button>)}
            <button className="btn small ghost" disabled={!!bulkBusy} onClick={bulkCredits}>+ credits</button>
            <button className="btn small ghost" onClick={() => setSel(new Set())}>Clear</button>
          </span>
        </div>
      )}

      {rows === null ? <Spinner /> : rows.length === 0 ? (
        <div className="section" style={{ textAlign: 'center', padding: 32 }}><p className="muted">No workspaces match.</p></div>
      ) : (
        <div className="section" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="plain" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Workspace</th><th>Plan</th><th>Status</th><th>Accts</th><th>Crit</th><th>Alerts</th>
                <th>Leads</th><th>Replied</th><th>Last login</th><th>Last sync</th><th>Risk</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.org.id}>
                  <td><input type="checkbox" style={{ width: 'auto' }} checked={sel.has(r.org.id)} onChange={() => toggle(r.org.id)} /></td>
                  <td>
                    <Link to={`/admin/orgs/${r.org.id}`} style={{ fontWeight: 600 }}>{r.org.name}</Link>
                    <div className="faint">{r.owner}</div>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{r.org.plan_tier}</td>
                  <td style={{ textTransform: 'capitalize' }}>{r.org.suspended_at ? 'suspended' : r.org.subscription_status.replace('_', ' ')}</td>
                  <td className="mono">{r.connCount}</td>
                  <td className="mono" style={r.openCriticals ? { color: 'var(--act)' } : {}}>{r.openCriticals}</td>
                  <td className="mono">{r.unackAlerts}</td>
                  <td className="mono">{r.leads}</td>
                  <td className="mono" style={{ color: 'var(--info)' }}>{r.replied}</td>
                  <td className="faint">{timeAgo(r.lastSeen)}</td>
                  <td className="faint">{timeAgo(r.lastSync)}</td>
                  <td><RiskChips risks={r.risks} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link to={`/admin/orgs/${r.org.id}`} className="btn small ghost" style={{ textDecoration: 'none', marginRight: 6 }}>Open</Link>
                    <button className="btn small ghost" onClick={async () => { await startViewAs(r.org.id, r.org.name); navigate('/dashboard'); }}>View as</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="row-between" style={{ marginTop: 12 }}>
          <button className="btn small ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
          <span className="faint">Page {page + 1} of {pages}</span>
          <button className="btn small ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
