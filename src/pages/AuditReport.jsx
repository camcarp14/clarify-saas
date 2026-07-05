import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { usePref } from '../lib/usePref';
import { timeAgo } from '../lib/format';
import { Chip, ShowMath, Spinner, Empty } from '../components/ui';

export default function AuditReport() {
  const { effectiveOrgId, supportView, profile } = useAuth();
  const [view, setView] = usePref('audit.view', 'open');       // open | all
  const [conns, setConns] = useState(null);
  const [connId, setConnId] = useState(null);
  const [audit, setAudit] = useState(null);
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!effectiveOrgId) return;
    supabase.from('google_ads_connections').select('*').eq('org_id', effectiveOrgId)
      .in('status', ['active', 'error']).order('created_at')
      .then(({ data }) => {
        setConns(data || []);
        setConnId((prev) => prev && data?.some((c) => c.id === prev) ? prev : data?.[0]?.id || null);
        if (!data?.length) setLoading(false);
      });
  }, [effectiveOrgId]);

  const load = async (cid) => {
    setLoading(true);
    const { data: audits } = await supabase.from('audits').select('*')
      .eq('connection_id', cid).eq('status', 'complete')
      .order('created_at', { ascending: false }).limit(1);
    const a = audits?.[0] || null;
    setAudit(a);
    if (a) {
      const { data: f } = await supabase.from('audit_findings').select('*')
        .eq('audit_id', a.id).order('sort_order');
      setFindings(f || []);
    } else setFindings([]);
    setLoading(false);
  };

  useEffect(() => { if (connId) load(connId); }, [connId]);

  const run = async () => {
    setRunning(true); setErr(null);
    try {
      await api('run-audit', { method: 'POST', body: { connection_id: connId } });
      await load(connId);
    } catch (e) { setErr(e.message); }
    finally { setRunning(false); }
  };

  if (conns === null) return <Spinner />;
  if (!conns.length) {
    return (
      <Empty title="Nothing to audit yet">
        Connect a Google Ads account first.
        <div style={{ marginTop: 16 }}><Link className="btn primary" style={{ textDecoration: 'none' }} to="/onboarding">Connect Google Ads</Link></div>
      </Empty>
    );
  }

  const score = audit?.score;
  const ringColor = score >= 80 ? 'var(--good)' : score >= 60 ? 'var(--watch)' : 'var(--act)';
  const groups = ['critical', 'warning', 'opportunity', 'pass'];
  const visible = view === 'all' ? findings
    : findings.filter((f) => f.severity !== 'pass' && f.status === 'open');
  const grouped = groups.map((g) => [g, visible.filter((f) => f.severity === g)]);
  const openCount = findings.filter((f) => f.status === 'open' && f.severity !== 'pass').length;

  return (
    <div>
      <div className="row-between">
        <h1>Account audit</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="seg small" role="tablist" aria-label="View">
            {[['open', 'Open issues'], ['all', 'Everything']].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{label}</button>
            ))}
          </div>
          {conns.length > 1 && (
            <select style={{ width: 'auto' }} value={connId || ''} onChange={(e) => setConnId(e.target.value)}>
              {conns.map((c) => <option key={c.id} value={c.id}>{c.descriptive_name || c.customer_id}</option>)}
            </select>
          )}
          <button className="btn primary" disabled={running || supportView} onClick={run}>
            {running ? 'Auditing…' : audit ? 'Run again' : 'Run first audit'}
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        Ten deterministic checks against your synced data. Every finding shows its math — no vibes, no black box.
      </p>
      {err && <div className="banner warn">{err}</div>}

      {loading ? <Spinner /> : !audit ? (
        <Empty title="No audit yet">Run one — it takes a few seconds against your last sync.</Empty>
      ) : (
        <>
          <div className="section" style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="score-ring" style={{ background: `conic-gradient(${ringColor} ${score * 3.6}deg, rgba(255,255,255,.09) 0deg)` }}>
              <div style={{ background: 'var(--surface)', width: 84, height: 84, borderRadius: '50%', display: 'grid', placeItems: 'center' }}>{score}</div>
            </div>
            <div>
              <h2>{score >= 80 ? 'Healthy, with sharpening to do' : score >= 60 ? 'Leaks worth plugging' : 'This account needs attention'}</h2>
              <p className="muted" style={{ margin: '6px 0 0' }}>
                {openCount === 0 ? 'No open issues.' : `${openCount} open item${openCount === 1 ? '' : 's'} below, ordered by how much they matter.`}
                {' '}Audited {timeAgo(audit.created_at)}.
              </p>
            </div>
          </div>

          {grouped.map(([sev, items]) => items.length > 0 && (
            <div key={sev} className="section">
              <h2 style={{ textTransform: 'capitalize' }}>{sev === 'pass' ? 'What\u2019s working' : sev === 'opportunity' ? 'Opportunities' : `${sev}s`}</h2>
              {items.map((f) => (
                <div key={f.id} className="card" style={{ marginTop: 10, opacity: f.status === 'resolved' ? 0.55 : 1 }}>
                  <div className="row-between">
                    <div><Chip severity={f.severity} /> <strong style={{ marginLeft: 6 }}>{f.title}</strong></div>
                    {f.severity !== 'pass' && f.status === 'open' && (
                      <button className="btn small ghost" disabled={supportView}
                        title={supportView ? 'Read-only in support view' : undefined}
                        onClick={async () => {
                          await supabase.from('audit_findings').update({
                            status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: profile.id,
                          }).eq('id', f.id);
                          setFindings((all) => all.map((x) => x.id === f.id ? { ...x, status: 'resolved' } : x));
                        }}>
                        Mark resolved
                      </button>
                    )}
                    {f.status === 'resolved' && <span className="faint">resolved</span>}
                  </div>
                  <p style={{ margin: '8px 0 0' }}>{f.summary}</p>
                  {f.recommendation && <p className="muted" style={{ margin: '6px 0 0' }}><strong>Do this:</strong> {f.recommendation}</p>}
                  <ShowMath evidence={f.evidence} />
                </div>
              ))}
            </div>
          ))}
          {view === 'open' && visible.length === 0 && (
            <Empty title="No open issues">
              Everything's either resolved or passing. Switch to <strong>Everything</strong> above to see resolved items and what's working.
            </Empty>
          )}
        </>
      )}
    </div>
  );
}
