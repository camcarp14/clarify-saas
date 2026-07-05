import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { usePref } from '../lib/usePref';
import { usd, usdN, pct, num, dayLabel, timeAgo } from '../lib/format';
import { Verdict, Chip, ShowMath, Spinner, Empty, Pill } from '../components/ui';

// The unified morning check. One page, two halves — ad health and pipeline —
// with a focus toggle so either half can own the screen when that's your morning.
export default function Dashboard() {
  const { effectiveOrgId, supportView, profile, org } = useAuth();
  const [focus, setFocus] = usePref('today.focus', 'all');       // all | ads | outreach
  const [range, setRange] = usePref('today.range', 30);          // chart window: 14 | 30

  // ---- paid search state ----
  const [conns, setConns] = useState(null);
  const [connId, setConnId] = useState(null);
  const [snaps, setSnaps] = useState([]);
  const [terms, setTerms] = useState([]);
  const [decisions, setDecisions] = useState({ findings: [], alerts: [] });
  const [adsLoading, setAdsLoading] = useState(true);

  // ---- outreach state ----
  const [outreach, setOutreach] = useState(null);
  const [busyTask, setBusyTask] = useState(null);

  useEffect(() => {
    if (!effectiveOrgId) return;
    supabase.from('google_ads_connections').select('*').eq('org_id', effectiveOrgId)
      .order('created_at').then(({ data }) => {
        const active = (data || []).filter((c) => c.status === 'active' || c.status === 'error');
        setConns(active);
        setConnId((prev) => prev && active.some((c) => c.id === prev) ? prev : active[0]?.id || null);
        if (!active.length) setAdsLoading(false);
      });
  }, [effectiveOrgId]);

  useEffect(() => {
    if (!connId || !effectiveOrgId) return;
    setAdsLoading(true);
    (async () => {
      const [s, t, latestAudit, al] = await Promise.all([
        supabase.from('metrics_snapshots').select('*').eq('connection_id', connId),
        supabase.from('search_term_stats').select('cost_micros, clicks, conversions, term').eq('connection_id', connId),
        supabase.from('audits').select('id').eq('connection_id', connId).eq('status', 'complete')
          .order('created_at', { ascending: false }).limit(1),
        supabase.from('alerts').select('*').eq('connection_id', connId).is('acknowledged_at', null)
          .order('triggered_at', { ascending: false }),
      ]);
      setSnaps(s.data || []);
      setTerms(t.data || []);
      let findings = [];
      const auditId = latestAudit.data?.[0]?.id;
      if (auditId) {
        const { data: f } = await supabase.from('audit_findings').select('*')
          .eq('audit_id', auditId).eq('status', 'open').in('severity', ['critical', 'warning'])
          .order('sort_order');
        findings = f || [];
      }
      setDecisions({ findings, alerts: al.data || [] });
      setAdsLoading(false);
    })();
  }, [connId, effectiveOrgId]);

  const loadOutreach = useCallback(async () => {
    if (!effectiveOrgId) return;
    const [tasks, unread, pipeline, recent] = await Promise.all([
      supabase.from('messages').select('*, leads(id, name, company, linkedin_url)')
        .eq('org_id', effectiveOrgId).eq('channel', 'linkedin').eq('status', 'queued')
        .order('created_at').limit(10),
      supabase.from('messages').select('id', { count: 'exact', head: true })
        .eq('org_id', effectiveOrgId).eq('direction', 'inbound').eq('is_read', false),
      supabase.from('leads').select('status').eq('org_id', effectiveOrgId),
      supabase.from('messages').select('*, leads(name, company)')
        .eq('org_id', effectiveOrgId).order('occurred_at', { ascending: false }).limit(6),
    ]);
    const counts = {};
    for (const l of pipeline.data || []) counts[l.status] = (counts[l.status] || 0) + 1;
    setOutreach({
      tasks: tasks.data || [], unread: unread.count || 0,
      counts, total: (pipeline.data || []).length, recent: recent.data || [],
    });
  }, [effectiveOrgId]);
  useEffect(() => { loadOutreach(); }, [loadOutreach]);

  const doTask = async (id, action) => {
    setBusyTask(id);
    try { await api('complete-task', { method: 'POST', body: { message_id: id, action } }); await loadOutreach(); }
    catch (e) { alert(e.message); }
    setBusyTask(null);
  };

  const conn = conns?.find((c) => c.id === connId);
  const m = useMemo(() => compute(snaps, terms), [snaps, terms]);
  const showAds = focus !== 'outreach';
  const showOutreach = focus !== 'ads';
  const c = outreach?.counts || {};
  const creditsLeft = Math.max(0, (org?.monthly_credits ?? 0) - (org?.credits_used ?? 0));
  const dateLine = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // combined "needs you" counts — the whole point of a morning check
  const needs = [
    outreach?.unread ? { label: `${outreach.unread} unread ${outreach.unread === 1 ? 'reply' : 'replies'}`, to: '/inbox', tone: 'info' } : null,
    outreach?.tasks?.length ? { label: `${outreach.tasks.length} LinkedIn ${outreach.tasks.length === 1 ? 'task' : 'tasks'}`, to: null, tone: 'clarity' } : null,
    decisions.alerts.length ? { label: `${decisions.alerts.length} unacked ${decisions.alerts.length === 1 ? 'alert' : 'alerts'}`, to: '/alerts', tone: 'watch' } : null,
    decisions.findings.length ? { label: `${decisions.findings.length} audit ${decisions.findings.length === 1 ? 'finding' : 'findings'}`, to: '/audit', tone: 'watch' } : null,
  ].filter(Boolean);

  if (conns === null) return <Spinner />;

  return (
    <div>
      <div className="row-between">
        <div>
          <h1>Today</h1>
          <div className="faint">{dateLine} · {org?.name}</div>
        </div>
        <div className="seg" role="tablist" aria-label="Focus">
          {[['all', 'Everything'], ['ads', 'Paid search'], ['outreach', 'Outreach']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={focus === k} className={focus === k ? 'on' : ''} onClick={() => setFocus(k)}>{label}</button>
          ))}
        </div>
      </div>

      {needs.length > 0 && (
        <div className="section" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 14 }}>
          <strong style={{ fontFamily: 'var(--display)', marginRight: 4 }}>Needs you:</strong>
          {needs.map((n, i) => n.to
            ? <Link key={i} to={n.to} className={`chip ${n.tone === 'watch' ? 'warning' : 'opportunity'}`} style={{ textDecoration: 'none' }}>{n.label} →</Link>
            : <button key={i} className="chip pass" style={{ border: 'none', cursor: 'pointer' }}
                onClick={() => { if (focus === 'ads') setFocus('all'); }}>{n.label} ↓</button>)}
        </div>
      )}
      {needs.length === 0 && !adsLoading && outreach && (
        <div className="section" style={{ padding: 14 }}>
          <Verdict tone="good">Nothing is waiting on you this morning. That's the goal.</Verdict>
        </div>
      )}

      {showAds && (
        <Section id="ads" title="Paid search"
          right={conns.length > 1 && (
            <select style={{ width: 'auto' }} value={connId || ''} onChange={(e) => setConnId(e.target.value)}>
              {conns.map((x) => <option key={x.id} value={x.id}>{x.descriptive_name || x.customer_id}</option>)}
            </select>
          )}>
          {!conns.length ? (
            <Empty title="No Google Ads account connected yet">
              Connect one and Clarify pulls your last 30 days immediately.
              <div style={{ marginTop: 14 }}><Link className="btn primary" style={{ textDecoration: 'none' }} to="/onboarding">Connect Google Ads</Link></div>
            </Empty>
          ) : adsLoading ? <Spinner /> : !snaps.length ? (
            <Empty title="First sync is running">Give it a couple of minutes, then refresh. Your last 30 days are on the way.</Empty>
          ) : (
            <>
              <div className="faint" style={{ marginBottom: 4 }}>
                {conn?.descriptive_name || conn?.customer_id} · synced {timeAgo(conn?.last_synced_at)}
                {conn?.status === 'error' && <span style={{ color: 'var(--act)' }}> · last sync failed</span>}
              </div>
              <div className="grid">
                <Card label="Spend this month" big={usd(m.mtd)} verdict={m.paceVerdict} />
                <Card label="Cost per customer (7d)" big={m.cpa7 != null ? usdN(m.cpa7) : '—'} verdict={m.cpaVerdict} />
                <Card label="Conversions this week" big={num(m.conv7)} verdict={m.convVerdict} />
                <Card label="Wasted spend (30d)" big={usd(m.wasted)} verdict={m.wasteVerdict} />
              </div>

              <div style={{ marginTop: 4 }}>
                <div className="row-between">
                  <h3>Spend & conversions</h3>
                  <div className="seg small" role="tablist" aria-label="Chart window">
                    {[[14, '14d'], [30, '30d']].map(([d, label]) => (
                      <button key={d} role="tab" aria-selected={range === d} className={range === d ? 'on' : ''} onClick={() => setRange(d)}>{label}</button>
                    ))}
                  </div>
                </div>
                <Verdict tone={m.chartTone}>{m.chartLine}</Verdict>
                <div style={{ height: 250, marginTop: 12 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={m.daily.slice(-range)} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--line)" vertical={false} />
                      <XAxis dataKey="d" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: '#6f7489' }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="spend" tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11, fill: '#6f7489' }} tickLine={false} axisLine={false} width={46} />
                      <YAxis yAxisId="conv" orientation="right" tick={{ fontSize: 11, fill: '#6f7489' }} tickLine={false} axisLine={false} width={30} />
                      <Tooltip labelFormatter={dayLabel} formatter={(v, name) => name === 'Spend' ? [usdN(v), name] : [v, name]} />
                      <Area yAxisId="spend" type="monotone" dataKey="spend" name="Spend" stroke="var(--clarity)" fill="var(--clarity-soft)" strokeWidth={2} />
                      <Line yAxisId="conv" type="monotone" dataKey="conv" name="Conversions" stroke="var(--info)" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <h3>What changed this week</h3>
                {m.movers.length === 0 && <p className="muted">No campaign moved more than a rounding error vs last week. Quiet weeks are allowed.</p>}
                {m.movers.map((mv) => (
                  <Verdict key={mv.id} tone={mv.tone}>
                    <strong>{mv.name}</strong>: {usdN(mv.prev)} → {usdN(mv.cur)} spend ({mv.dir}{pct(Math.abs(mv.change))}){mv.note}
                  </Verdict>
                ))}
              </div>

              <div style={{ marginTop: 18 }}>
                <div className="row-between">
                  <h3>Needs a decision</h3>
                  <Link to="/audit" className="faint">Full audit →</Link>
                </div>
                {!decisions.findings.length && !decisions.alerts.length && (
                  <p className="muted">Nothing is waiting on you. That's the goal.</p>
                )}
                {decisions.alerts.map((a) => (
                  <DecisionRow key={a.id} chip={a.severity} title={a.title} body={a.body} evidence={a.evidence}
                    action="Acknowledge" disabled={supportView}
                    onAction={async () => {
                      await supabase.from('alerts').update({ acknowledged_at: new Date().toISOString(), acknowledged_by: profile.id }).eq('id', a.id);
                      setDecisions((d) => ({ ...d, alerts: d.alerts.filter((x) => x.id !== a.id) }));
                    }} />
                ))}
                {decisions.findings.map((fd) => (
                  <DecisionRow key={fd.id} chip={fd.severity} title={fd.title} body={fd.summary} evidence={fd.evidence}
                    action="Mark resolved" disabled={supportView}
                    onAction={async () => {
                      await supabase.from('audit_findings').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: profile.id }).eq('id', fd.id);
                      setDecisions((d) => ({ ...d, findings: d.findings.filter((x) => x.id !== fd.id) }));
                    }} />
                ))}
              </div>
            </>
          )}
        </Section>
      )}

      {showOutreach && (
        <Section id="pipeline" title="Outreach pipeline"
          right={<span className="faint mono">{creditsLeft} discovery credits left</span>}>
          {!outreach ? <Spinner /> : !outreach.total && !outreach.tasks.length ? (
            <Empty title="No pipeline yet">
              Discover leads, put them in a sequence, and this becomes the other half of your morning.
              <div style={{ marginTop: 14 }}><Link className="btn primary" style={{ textDecoration: 'none' }} to="/discover">Find leads</Link></div>
            </Empty>
          ) : (
            <>
              <div className="grid">
                <Card label="Pipeline" big={num(outreach.total)} verdict={{ tone: 'info', text: `${c.new || 0} new · ${c.enriched || 0} enriched` }} />
                <Card label="In sequence" big={num(c.in_sequence || 0)} verdict={{ tone: 'info', text: 'hearing from you on schedule' }} />
                <Card label="Replied" big={num(c.replied || 0)} verdict={{ tone: (c.replied || 0) > 0 ? 'good' : 'info', text: 'conversations open — the whole point' }} />
                <Card label="Won" big={num(c.won || 0)} verdict={{ tone: 'info', text: `${c.lost || 0} lost` }} />
              </div>

              {outreach.unread > 0 && (
                <div className="banner info" style={{ marginTop: 4 }}>
                  <span><strong>{outreach.unread}</strong> unread {outreach.unread === 1 ? 'reply' : 'replies'} waiting.</span>
                  <Link to="/inbox" className="btn small primary" style={{ color: '#fff', textDecoration: 'none' }}>Open inbox</Link>
                </div>
              )}

              {outreach.tasks.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="row-between">
                    <h3>LinkedIn queue</h3>
                    <span className="faint">Drafted for you — you click send. Never automated.</span>
                  </div>
                  {outreach.tasks.map((t) => (
                    <div key={t.id} className="bubble outbound">
                      <div className="meta"><strong>{t.leads?.name || t.leads?.company || 'Lead'}</strong><span>queued {timeAgo(t.created_at)}</span></div>
                      <pre>{t.body_text}</pre>
                      <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
                        <button className="btn small ghost" onClick={() => navigator.clipboard.writeText(t.body_text)}>Copy</button>
                        {t.leads?.linkedin_url && (
                          <a className="btn small ghost" href={t.leads.linkedin_url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)', textDecoration: 'none' }}>Open LinkedIn ↗</a>
                        )}
                        {!supportView && <>
                          <button className="btn small primary" disabled={busyTask === t.id} onClick={() => doTask(t.id, 'sent')}>I sent it</button>
                          <button className="btn small ghost" disabled={busyTask === t.id} onClick={() => doTask(t.id, 'skipped')}>Skip</button>
                        </>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {outreach.recent.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <h3>Recent activity</h3>
                  <table className="plain" style={{ marginTop: 6 }}>
                    <tbody>
                      {outreach.recent.map((r) => (
                        <tr key={r.id}>
                          <td style={{ width: 92 }}><Pill v={r.direction === 'inbound' ? 'received' : r.status} /></td>
                          <td>{r.leads?.name || r.leads?.company || '—'}</td>
                          <td className="muted">{r.channel} · {(r.snippet || r.subject || '').slice(0, 64)}</td>
                          <td className="faint" style={{ whiteSpace: 'nowrap' }}>{timeAgo(r.occurred_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Section>
      )}
    </div>
  );
}

// Collapsible section, open/closed state persisted per section.
function Section({ id, title, right, children }) {
  const [open, setOpen] = usePref('today.open.' + id, true);
  return (
    <div className="section">
      <div className="row-between">
        <button className="collapse-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={`chev ${open ? 'open' : ''}`}>▸</span>
          <span className="section-title">{title}</span>
        </button>
        {open && right}
      </div>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

function Card({ label, big, verdict }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="big">{big}</div>
      {verdict && <Verdict tone={verdict.tone}>{verdict.text}</Verdict>}
    </div>
  );
}

function DecisionRow({ chip, title, body, evidence, action, onAction, disabled }) {
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="row-between">
        <div><Chip severity={chip} /> <strong style={{ marginLeft: 6 }}>{title}</strong></div>
        <button className="btn small ghost" disabled={disabled} title={disabled ? 'Read-only in support view' : undefined} onClick={onAction}>{action}</button>
      </div>
      <p className="muted" style={{ margin: '8px 0 0' }}>{body}</p>
      <ShowMath evidence={evidence} />
    </div>
  );
}

// ---------- all card math lives here, in one auditable place ----------
function compute(snaps, terms) {
  const dates = [...new Set(snaps.map((s) => s.snapshot_date))].sort();
  const byDate = {};
  for (const s of snaps) {
    const d = (byDate[s.snapshot_date] ||= { d: s.snapshot_date, spend: 0, conv: 0 });
    d.spend += Number(s.cost_micros) / 1e6;
    d.conv += Number(s.conversions);
  }
  const daily = dates.map((d) => ({ ...byDate[d], spend: Math.round(byDate[d].spend), conv: Math.round(byDate[d].conv * 10) / 10 }));

  const winSum = (n, offset = 0) => {
    const w = dates.slice(dates.length - n - offset, dates.length - offset);
    let cost = 0, conv = 0;
    for (const s of snaps) if (w.includes(s.snapshot_date)) { cost += Number(s.cost_micros); conv += Number(s.conversions); }
    return { cost, conv };
  };

  const monthKey = new Date().toISOString().slice(0, 7);
  const day = new Date().getUTCDate();
  const mtd = snaps.filter((s) => s.snapshot_date.startsWith(monthKey)).reduce((t, s) => t + Number(s.cost_micros), 0);
  const latestByCampaign = {};
  for (const s of snaps) {
    const cur = latestByCampaign[s.campaign_id];
    if (!cur || s.snapshot_date > cur.snapshot_date) latestByCampaign[s.campaign_id] = s;
  }
  const dailyBudget = Object.values(latestByCampaign).filter((s) => s.campaign_status === 'ENABLED')
    .reduce((t, s) => t + Number(s.budget_micros), 0);
  const pace = dailyBudget ? mtd / (dailyBudget * day) : null;
  const paceVerdict = pace == null
    ? { tone: 'info', text: 'No enabled budgets found to pace against.' }
    : pace > 1.2 ? { tone: 'act', text: `Running ${pct(pace - 1)} over what your budgets imply — check where it's going.` }
    : pace < 0.7 ? { tone: 'watch', text: `Running ${pct(1 - pace)} under budget — demand or delivery is being throttled.` }
    : { tone: 'good', text: `On pace with your budgets (${Math.round(pace * 100) / 100}×). Nothing to do here.` };

  const w7 = winSum(7), prior28 = winSum(28, 7);
  const cpa7 = w7.conv ? w7.cost / 1e6 / w7.conv : null;
  const cpaBase = prior28.conv ? prior28.cost / 1e6 / prior28.conv : null;
  const cpaVerdict = cpa7 == null
    ? { tone: 'watch', text: 'No conversions in the last 7 days — if that\u2019s unusual, check tracking first.' }
    : cpaBase == null ? { tone: 'info', text: 'Not enough history yet for a baseline.' }
    : cpa7 > cpaBase * 1.3 ? { tone: 'act', text: `${pct(cpa7 / cpaBase - 1)} above your ${usdN(cpaBase)} norm. Worth a look today.` }
    : cpa7 < cpaBase * 0.8 ? { tone: 'good', text: `${pct(1 - cpa7 / cpaBase)} cheaper than your ${usdN(cpaBase)} norm. Whatever changed, keep it.` }
    : { tone: 'good', text: `In line with your ${usdN(cpaBase)} norm.` };

  const wPrev7 = winSum(7, 7);
  const conv7 = Math.round(w7.conv);
  const convVerdict = wPrev7.conv
    ? (w7.conv >= wPrev7.conv
      ? { tone: 'good', text: `Up from ${Math.round(wPrev7.conv)} last week.` }
      : { tone: 'watch', text: `Down from ${Math.round(wPrev7.conv)} last week.` })
    : { tone: 'info', text: 'No prior week to compare against yet.' };

  const wasted = terms.filter((t) => Number(t.clicks) >= 5 && Number(t.conversions) === 0)
    .reduce((s, t) => s + Number(t.cost_micros), 0);
  const termSpend = terms.reduce((s, t) => s + Number(t.cost_micros), 0);
  const wasteShare = termSpend ? wasted / termSpend : 0;
  const wasteVerdict = wasted === 0
    ? { tone: 'good', text: 'No repeat-click, zero-conversion searches burning money.' }
    : { tone: wasteShare > 0.15 ? 'act' : wasteShare > 0.07 ? 'watch' : 'info', text: `${pct(wasteShare)} of search spend — clicks ≥ 5, conversions 0. Negative-keyword material.` };

  const total30 = winSum(30);
  const chartTone = total30.conv > 0 ? 'info' : 'watch';
  const chartLine = total30.conv > 0
    ? `${usd(total30.cost)} in, ${Math.round(total30.conv)} conversions out over 30 days — about ${usdN(total30.cost / 1e6 / total30.conv)} per customer.`
    : `${usd(total30.cost)} spent in 30 days with no recorded conversions. Either tracking is broken or the money is.`;

  const byCampaign = {};
  for (const s of snaps) {
    const cc = (byCampaign[s.campaign_id] ||= { id: s.campaign_id, name: s.campaign_name, cur: 0, prev: 0 });
    const idx = dates.indexOf(s.snapshot_date);
    if (idx >= dates.length - 7) cc.cur += Number(s.cost_micros) / 1e6;
    else if (idx >= dates.length - 14) cc.prev += Number(s.cost_micros) / 1e6;
  }
  const movers = Object.values(byCampaign)
    .filter((x) => x.prev + x.cur > 50)
    .map((x) => ({ ...x, change: x.prev ? (x.cur - x.prev) / x.prev : 1 }))
    .filter((x) => Math.abs(x.change) > 0.25)
    .sort((a, b) => Math.abs(b.cur - b.prev) - Math.abs(a.cur - a.prev))
    .slice(0, 5)
    .map((x) => ({
      ...x,
      cur: Math.round(x.cur), prev: Math.round(x.prev),
      dir: x.change > 0 ? '↑' : '↓',
      tone: x.change > 0 ? 'watch' : 'info',
      note: x.change > 0 ? ' — make sure the extra spend is buying results.' : '',
    }));

  return { daily, mtd, pace, paceVerdict, cpa7, cpaVerdict, conv7, convVerdict, wasted, wasteVerdict, chartTone, chartLine, movers };
}
