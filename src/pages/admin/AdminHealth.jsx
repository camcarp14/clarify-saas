import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';
import { Spinner } from '../../components/ui';
import { timeAgo } from '../../lib/format';
import { PRICE, usd0 } from './shared';

// Mirrors sync-scheduler.js — if you change cadence there, change it here.
const CADENCE_HOURS = { starter: 22, growth: 22, pro: 0.9 };

// "Is the machine running" — cross-org operational view, no single customer's data.
export default function AdminHealth() {
  const [d, setD] = useState(null);

  useEffect(() => {
    (async () => {
      const now = Date.now();
      const [conns, enrolls, orgs, stripeHealth] = await Promise.all([
        supabase.from('google_ads_connections').select('*, organizations(id, name, plan_tier)').in('status', ['active', 'error']),
        supabase.from('enrollments').select('id, org_id, next_run_at, status').eq('status', 'active')
          .lt('next_run_at', new Date(now - 30 * 60000).toISOString()).order('next_run_at').limit(50),
        supabase.from('organizations').select('*'),
        api('admin-health').catch(() => ({ stripeEvents: [], stripeEvents24h: null })),
      ]);

      const connRows = conns.data || [];
      const errored = connRows.filter((c) => c.status === 'error');
      const stale = connRows.filter((c) => {
        if (c.status !== 'active') return false;
        const hours = CADENCE_HOURS[c.organizations?.plan_tier] ?? 22;
        // 2× the expected cadence = genuinely stuck, not just between ticks
        const staleAfter = hours * 2 * 3600 * 1000;
        return !c.last_synced_at || now - new Date(c.last_synced_at).getTime() > staleAfter;
      }).sort((a, b) => new Date(a.last_synced_at || 0) - new Date(b.last_synced_at || 0));

      const orgRows = orgs.data || [];
      const active = orgRows.filter((o) => o.subscription_status === 'active');
      const mrr = active.reduce((s, o) => s + (PRICE[o.plan_tier] || 0), 0);
      const creditTotals = orgRows.reduce((s, o) => ({ used: s.used + (o.credits_used || 0), total: s.total + (o.monthly_credits || 0) }), { used: 0, total: 0 });

      setD({
        errored, stale, activeConns: connRows.filter((c) => c.status === 'active').length,
        overdue: enrolls.data || [],
        orgs: orgRows, active: active.length,
        trialing: orgRows.filter((o) => o.subscription_status === 'trialing').length,
        pastDue: orgRows.filter((o) => o.subscription_status === 'past_due').length,
        suspended: orgRows.filter((o) => o.suspended_at).length,
        mrr, creditTotals,
        stripe: stripeHealth,
      });
    })();
  }, []);
  if (!d) return <Spinner />;

  const orgName = (id) => d.orgs.find((o) => o.id === id)?.name || id?.slice(0, 8);
  const machineOk = d.errored.length === 0 && d.stale.length === 0 && d.overdue.length === 0;

  return (
    <div>
      <h1>System health</h1>
      <p className="muted">Cross-workspace view of the machine itself — sync engine, outreach engine, Stripe pulse. Catch it before a customer does.</p>

      <div className="grid" style={{ marginTop: 14 }}>
        <div className="card"><div className="label">Ads syncs</div><div className="big">{d.activeConns}</div>
          <p className="muted" style={{ margin: '6px 0 0', color: d.errored.length ? 'var(--act)' : undefined }}>
            {d.errored.length ? `${d.errored.length} in error` : 'none erroring'} · {d.stale.length ? `${d.stale.length} stale` : 'none stale'}</p></div>
        <div className="card"><div className="label">Outreach engine</div><div className="big">{d.overdue.length}</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>{d.overdue.length ? 'enrollments overdue 30m+' : 'no overdue enrollments'}</p></div>
        <div className="card"><div className="label">Stripe events (24h)</div><div className="big">{d.stripe.stripeEvents24h ?? '—'}</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {d.stripe.stripeEvents?.[0] ? `last: ${timeAgo(d.stripe.stripeEvents[0].processed_at)}` : 'no events recorded yet'}</p></div>
        <div className="card"><div className="label">Business</div><div className="big">{usd0(d.mrr)}</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>{d.active} active · {d.trialing} trialing · {d.pastDue} past due{d.suspended ? ` · ${d.suspended} suspended` : ''}</p></div>
      </div>

      {machineOk && (
        <div className="section" style={{ padding: 14 }}>
          <span className="chip pass">All clear</span>
          <span className="muted" style={{ marginLeft: 10 }}>Nothing is stuck, erroring, or overdue right now.</span>
        </div>
      )}

      {d.errored.length > 0 && (
        <div className="section">
          <h2>Connections in error</h2>
          {d.errored.map((c) => (
            <div key={c.id} className="row-between" style={{ borderBottom: '1px solid var(--line)', padding: '9px 0' }}>
              <div>
                <Link to={`/admin/orgs/${c.organizations?.id}`} style={{ fontWeight: 600 }}>{c.organizations?.name}</Link>
                <span className="faint mono" style={{ marginLeft: 8, fontSize: 12 }}>{c.customer_id}</span>
                <div className="faint" style={{ marginTop: 2 }}>{(c.last_sync_error || '').slice(0, 120)}</div>
              </div>
              <span className="faint" style={{ whiteSpace: 'nowrap' }}>synced {timeAgo(c.last_synced_at)}</span>
            </div>
          ))}
        </div>
      )}

      {d.stale.length > 0 && (
        <div className="section">
          <h2>Stale syncs (2× past their plan's cadence)</h2>
          <p className="muted">Usually means the scheduler skipped them or Google throttled — worth a manual re-sync from the org page.</p>
          {d.stale.map((c) => (
            <div key={c.id} className="row-between" style={{ borderBottom: '1px solid var(--line)', padding: '9px 0' }}>
              <div>
                <Link to={`/admin/orgs/${c.organizations?.id}`} style={{ fontWeight: 600 }}>{c.organizations?.name}</Link>
                <span className="faint" style={{ marginLeft: 8, textTransform: 'capitalize' }}>{c.organizations?.plan_tier}</span>
              </div>
              <span className="faint">last synced {timeAgo(c.last_synced_at)}</span>
            </div>
          ))}
        </div>
      )}

      {d.overdue.length > 0 && (
        <div className="section">
          <h2>Overdue enrollments</h2>
          <p className="muted">Active sequence enrollments whose next step is 30+ minutes past due — if this list grows, the outreach scheduler or sequence runner is stuck.</p>
          {d.overdue.slice(0, 15).map((e) => (
            <div key={e.id} className="row-between" style={{ borderBottom: '1px solid var(--line)', padding: '9px 0' }}>
              <Link to={`/admin/orgs/${e.org_id}`}>{orgName(e.org_id)}</Link>
              <span className="faint">due {timeAgo(e.next_run_at)}</span>
            </div>
          ))}
          {d.overdue.length > 15 && <p className="faint" style={{ marginTop: 8 }}>…and {d.overdue.length - 15} more.</p>}
        </div>
      )}

      <div className="section">
        <h2>Discovery credits, platform-wide</h2>
        <p className="muted">{d.creditTotals.used.toLocaleString()} of {d.creditTotals.total.toLocaleString()} monthly credits used across all workspaces this period.</p>
      </div>

      <p className="faint" style={{ marginTop: 18 }}>
        Honest gap: there's no scheduled-function heartbeat table, so "when did sync-scheduler /
        outreach-scheduler last actually run" isn't knowable from data — staleness above is the proxy.
        A tiny heartbeat table is a 20-minute add if that ever matters.
      </p>
    </div>
  );
}
