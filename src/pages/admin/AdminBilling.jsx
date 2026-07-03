import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Spinner } from '../../components/ui';
import { PRICE, usd0 } from './shared';
import { timeAgo } from '../../lib/format';

// Revenue lens: MRR rollup + the three lists that actually need intervention.
export default function AdminBilling() {
  const [orgs, setOrgs] = useState(null);
  useEffect(() => {
    supabase.from('organizations').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setOrgs(data || []));
  }, []);
  if (!orgs) return <Spinner />;

  const active = orgs.filter((o) => o.subscription_status === 'active');
  const mrrByTier = { starter: 0, growth: 0, pro: 0 };
  active.forEach((o) => { mrrByTier[o.plan_tier] = (mrrByTier[o.plan_tier] || 0) + (PRICE[o.plan_tier] || 0); });
  const mrr = Object.values(mrrByTier).reduce((a, b) => a + b, 0);
  const pastDue = orgs.filter((o) => o.subscription_status === 'past_due');
  const trialing = orgs.filter((o) => o.subscription_status === 'trialing' && !o.stripe_subscription_id)
    .sort((a, b) => new Date(a.trial_ends_at) - new Date(b.trial_ends_at));
  const canceled = orgs.filter((o) => o.subscription_status === 'canceled');

  const Row = ({ o, extra }) => (
    <div className="row-between" style={{ borderBottom: '1px solid var(--line)', padding: '9px 0' }}>
      <Link to={`/admin/orgs/${o.id}`} style={{ fontWeight: 600 }}>{o.name}</Link>
      <span className="faint">{extra}</span>
    </div>
  );

  return (
    <div>
      <h1>Billing</h1>
      <p className="muted">One bundled subscription per workspace — this is the money view.</p>
      <div className="grid" style={{ marginTop: 14 }}>
        <div className="card"><div className="label">MRR</div><div className="big">{usd0(mrr)}</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>{active.length} paying workspace{active.length === 1 ? '' : 's'}</p></div>
        {['starter', 'growth', 'pro'].map((t) => (
          <div className="card" key={t}><div className="label" style={{ textTransform: 'capitalize' }}>{t}</div>
            <div className="big">{usd0(mrrByTier[t])}</div>
            <p className="muted" style={{ margin: '6px 0 0' }}>{active.filter((o) => o.plan_tier === t).length} × {usd0(PRICE[t])}/mo</p></div>
        ))}
      </div>

      <div className="section">
        <h2>Past due — needs a nudge ({pastDue.length})</h2>
        {pastDue.length === 0 && <p className="muted">Nobody. Good.</p>}
        {pastDue.map((o) => <Row key={o.id} o={o} extra={`since ${timeAgo(o.created_at)}`} />)}
      </div>
      <div className="section">
        <h2>Active trials, soonest ending first ({trialing.length})</h2>
        {trialing.length === 0 && <p className="muted">No unconverted trials right now.</p>}
        {trialing.map((o) => {
          const d = Math.ceil((new Date(o.trial_ends_at) - Date.now()) / 86400000);
          return <Row key={o.id} o={o} extra={d < 0 ? 'expired' : `${d} day${d === 1 ? '' : 's'} left`} />;
        })}
      </div>
      <div className="section">
        <h2>Canceled ({canceled.length})</h2>
        {canceled.length === 0 && <p className="muted">None.</p>}
        {canceled.map((o) => <Row key={o.id} o={o} extra={o.plan_tier} />)}
      </div>
    </div>
  );
}
