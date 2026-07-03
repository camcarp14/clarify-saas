import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePref } from '../lib/usePref';
import { timeAgo } from '../lib/format';
import { Chip, ShowMath, Spinner, Empty } from '../components/ui';

export default function Alerts() {
  const { effectiveOrgId, supportView, profile } = useAuth();
  const [alerts, setAlerts] = useState(null);
  const [view, setView] = usePref('alerts.view', 'open');      // open | all

  useEffect(() => {
    if (!effectiveOrgId) return;
    supabase.from('alerts').select('*').eq('org_id', effectiveOrgId)
      .order('triggered_at', { ascending: false }).limit(100)
      .then(({ data }) => setAlerts(data || []));
  }, [effectiveOrgId]);

  if (alerts === null) return <Spinner />;

  const ack = async (a) => {
    await supabase.from('alerts').update({
      acknowledged_at: new Date().toISOString(), acknowledged_by: profile.id,
    }).eq('id', a.id);
    setAlerts((all) => all.map((x) => x.id === a.id ? { ...x, acknowledged_at: new Date().toISOString() } : x));
  };

  const shown = view === 'all' ? alerts : alerts.filter((a) => !a.acknowledged_at);

  return (
    <div>
      <div className="row-between">
        <h1>Alerts</h1>
        <div className="seg small" role="tablist" aria-label="View">
          {[['open', 'Needs attention'], ['all', 'All']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{label}</button>
          ))}
        </div>
      </div>
      <p className="muted">Clarify watches four failure modes between your morning checks: budget overpacing, CPA spikes, conversion-tracking flatlines, and PMax eating your brand traffic. You get an email when one fires.</p>
      {!shown.length && (
        <Empty title={view === 'open' ? 'Nothing needs you' : 'No alerts yet'}>
          {view === 'open' && alerts.length
            ? <>All {alerts.length} alert{alerts.length === 1 ? ' is' : 's are'} acknowledged. Switch to <strong>All</strong> to review the history.</>
            : <>When something needs you before your morning check, it shows up here — and in your inbox.</>}
        </Empty>
      )}
      {shown.map((a) => (
        <div key={a.id} className="card" style={{ marginTop: 10, opacity: a.acknowledged_at ? 0.55 : 1 }}>
          <div className="row-between">
            <div><Chip severity={a.severity} /> <strong style={{ marginLeft: 6 }}>{a.title}</strong></div>
            {a.acknowledged_at
              ? <span className="faint">acknowledged</span>
              : <button className="btn small ghost" disabled={supportView} title={supportView ? 'Read-only in support view' : undefined} onClick={() => ack(a)}>Acknowledge</button>}
          </div>
          <p className="muted" style={{ margin: '8px 0 0' }}>{a.body}</p>
          <div className="faint" style={{ marginTop: 6 }}>{timeAgo(a.triggered_at)}{a.emailed_at ? ' · emailed' : ''}</div>
          <ShowMath evidence={a.evidence} />
        </div>
      ))}
    </div>
  );
}
