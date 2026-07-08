import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { usePref } from '../lib/usePref';
import { timeAgo, usd, usdN } from '../lib/format';
import { Chip, ShowMath, Spinner, Empty, Ring, ChannelTabs, PillarTag, Num, SkPage, SkLine } from '../components/ui';
import { buildModel } from '../engine/model.js';
import { rowToPage } from '../engine/rows.js';

// The Search Audit — one page, both sides of the results page.
// Paid = the account you rent. Organic = the asset you own. Overlap = where they meet.
export default function AuditReport() {
  const { effectiveOrgId, supportView, profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = usePref('audit.tab', 'overview');      // overview | paid | organic | overlap
  const [view, setView] = usePref('audit.view', 'open');        // open | all
  const [toast, setToast] = useState(null);

  // scores for the persistent instrument
  const [paidScore, setPaidScore] = useState(null);
  const [orgScore, setOrgScore] = useState(null);

  // land on ?tab= (deep links from oauth + dashboard)
  useEffect(() => {
    const t = params.get('tab');
    if (t && ['paid', 'organic', 'overlap'].includes(t)) setTab(t);
    if (params.get('gsc') === 'connected') setToast({ kind: 'ok', text: 'Search Console connected — first query sync is running.' });
    if (params.get('error') === 'gsc_failed') setToast({ kind: 'err', text: 'Search Console connection failed. Try again from the Organic tab.' });
    if (t || params.get('gsc') || params.get('error')) setParams({}, { replace: true });
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!effectiveOrgId) return;
    supabase.from('audits').select('score').eq('org_id', effectiveOrgId).eq('status', 'complete')
      .order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => setPaidScore(data?.[0]?.score ?? null));
    supabase.from('organic_audits').select('score').eq('org_id', effectiveOrgId).eq('status', 'complete')
      .order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => setOrgScore(data?.[0]?.score ?? null));
  }, [effectiveOrgId, tab]);

  const verdict = () => {
    if (paidScore == null && orgScore == null) return 'Run your first audit — either channel is a fine place to start.';
    if (paidScore != null && orgScore == null) return 'Paid is scored. Crawl your site and the other half of this instrument lights up.';
    if (paidScore == null && orgScore != null) return 'Organic is scored. Connect Google Ads to see the clicks you\u2019re buying.';
    const gap = paidScore - orgScore;
    if (Math.abs(gap) <= 8) return 'Both channels are in the same shape — work the top findings in each.';
    return gap > 0
      ? 'Paid is in better shape than organic — the cheapest wins right now are on the earned side.'
      : 'Organic is in better shape than paid — the fastest savings right now are in the ad account.';
  };

  return (
    <div data-ch={tab}>
      <div className="row-between">
        <h1>Search</h1>
        <ChannelTabs value={tab} onChange={setTab} items={[
          { k: 'overview', label: 'Overview' }, { k: 'paid', label: 'Paid' }, { k: 'organic', label: 'Organic' }, { k: 'overlap', label: 'Overlap' },
        ]} />
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        Deterministic checks on both sides of the results page. Every finding shows its math — no vibes, no black box.
      </p>
      {toast && <div className={`banner ${toast.kind}`}>{toast.text}</div>}

      {tab !== 'overview' && (
      <div className="section">
        <div className="inst" style={{ paddingBottom: 20 }}>
          <Ring score={paidScore} channel="paid" cap="Paid" size={tab === 'paid' ? 104 : 88} />
          <Ring score={orgScore} channel="organic" cap="Organic" size={tab === 'organic' ? 104 : 88} />
          <div className="divider" />
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ fontSize: 18 }}>{verdict()}</h2>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Clicks you <span style={{ color: 'var(--paid)' }}>buy</span> and clicks you <span style={{ color: 'var(--org)' }}>earn</span>, scored on the same 0–100 scale.
            </p>
          </div>
        </div>
      </div>
      )}

      <div key={tab} className="pagefade">
      {tab === 'overview' && <OverviewTab {...{ setTab }} />}
      {tab === 'paid' && <PaidTab {...{ effectiveOrgId, supportView, profile, view, setView, onScore: setPaidScore }} />}
      {tab === 'organic' && <OrganicTab {...{ effectiveOrgId, supportView, profile, view, setView, onScore: setOrgScore }} />}
      {tab === 'overlap' && <OverlapTab {...{ effectiveOrgId, setTab }} />}
      </div>
    </div>
  );
}

// ---------- shared finding card ----------
function FindingCard({ f, table, supportView, profile, onResolved }) {
  return (
    <div className="card" style={{ marginTop: 10, opacity: f.status === 'resolved' ? 0.55 : 1 }}>
      <div className="row-between">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip severity={f.severity} />{f.pillar && <PillarTag pillar={f.pillar} />}<strong>{f.title}</strong>
          {f.value_month > 0 && <span className="mono" style={{ color: 'var(--paid)', fontWeight: 600 }}>{usdN(Math.round(f.value_month))}/mo</span>}
        </div>
        {f.severity !== 'pass' && f.status === 'open' && table && (
          <button className="btn small ghost" disabled={supportView}
            title={supportView ? 'Read-only in support view' : undefined}
            onClick={async () => {
              await supabase.from(table).update({
                status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: profile.id,
              }).eq('id', f.id);
              onResolved(f.id);
            }}>
            Mark resolved
          </button>
        )}
        {f.status === 'resolved' && <span className="faint">resolved</span>}
      </div>
      <p style={{ margin: '8px 0 0' }}>{f.summary}</p>
      {f.recommendation && <p className="muted" style={{ margin: '6px 0 0' }}><strong>Do this:</strong> {f.recommendation}</p>}
      {f.fix && f.status === 'open' && (
        <p style={{ margin: '6px 0 0' }}><Link to="/playbook" style={{ color: 'var(--org)', fontWeight: 600 }}>Open the drafted fix in the Playbook →</Link></p>
      )}
      <ShowMath evidence={f.evidence} />
    </div>
  );
}

function FindingGroups({ findings, view, table, supportView, profile, setFindings }) {
  const groups = ['critical', 'warning', 'opportunity', 'pass'];
  const visible = view === 'all' ? findings : findings.filter((f) => f.severity !== 'pass' && f.status === 'open');
  const grouped = groups.map((g) => [g, visible.filter((f) => f.severity === g)]);
  return (
    <>
      {grouped.map(([sev, items]) => items.length > 0 && (
        <div key={sev} className="section">
          <h2 style={{ textTransform: 'capitalize' }}>{sev === 'pass' ? 'What\u2019s working' : sev === 'opportunity' ? 'Opportunities' : `${sev}s`}</h2>
          {items.map((f) => (
            <FindingCard key={f.id} f={f} table={table} supportView={supportView} profile={profile}
              onResolved={(id) => setFindings((all) => all.map((x) => x.id === id ? { ...x, status: 'resolved' } : x))} />
          ))}
        </div>
      ))}
      {view === 'open' && visible.length === 0 && (
        <Empty title="No open issues">
          Everything's either resolved or passing. Switch to <strong>Everything</strong> above to see resolved items and what's working.
        </Empty>
      )}
    </>
  );
}

const ViewSeg = ({ view, setView }) => (
  <div className="seg small" role="tablist" aria-label="View">
    {[['open', 'Open issues'], ['all', 'Everything']].map(([k, label]) => (
      <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{label}</button>
    ))}
  </div>
);

// ---------- PAID ----------
function PaidTab({ effectiveOrgId, supportView, profile, view, setView, onScore }) {
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
      onScore(a.score);
      const { data: f } = await supabase.from('audit_findings').select('*').eq('audit_id', a.id).order('sort_order');
      setFindings(f || []);
    } else setFindings([]);
    setLoading(false);
  };
  useEffect(() => { if (connId) load(connId); }, [connId]); // eslint-disable-line

  const run = async () => {
    setRunning(true); setErr(null);
    try { await api('run-audit', { method: 'POST', body: { connection_id: connId } }); await load(connId); }
    catch (e) { setErr(e.message); }
    finally { setRunning(false); }
  };

  if (conns === null) return <SkPage cards={4} />;
  if (!conns.length) {
    return (
      <Empty title="Nothing to audit on the paid side yet">
        Connect a Google Ads account and Clarify pulls your last 30 days immediately.
        <div style={{ marginTop: 16 }}><Link className="btn primary" style={{ textDecoration: 'none' }} to="/onboarding">Connect Google Ads</Link></div>
      </Empty>
    );
  }
  const openCount = findings.filter((f) => f.status === 'open' && f.severity !== 'pass').length;

  return (
    <>
      <div className="row-between" style={{ marginTop: 4 }}>
        <p className="muted" style={{ margin: 0 }}>
          {audit ? <>Ten checks on the ad account. {openCount === 0 ? 'No open items.' : `${openCount} open item${openCount === 1 ? '' : 's'}, ordered by how much they matter.`} Audited {timeAgo(audit.created_at)}.</> : 'Ten deterministic checks against your synced data.'}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <ViewSeg view={view} setView={setView} />
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
      {err && <div className="banner warn">{err}</div>}
      {loading ? <div className="section"><SkLine w="w40" /><SkLine /><SkLine w="w80" /><SkLine w="w60" /></div> : !audit
        ? <Empty title="No paid audit yet">Run one — it takes a few seconds against your last sync.</Empty>
        : <FindingGroups {...{ findings, view, supportView, profile, setFindings }} table="audit_findings" />}
    </>
  );
}

// ---------- ORGANIC ----------
function OrganicTab({ effectiveOrgId, supportView, profile, view, setView, onScore }) {
  const [prop, setProp] = useState(undefined);       // undefined loading | null none | row
  const [siteInput, setSiteInput] = useState('');
  const [audit, setAudit] = useState(null);
  const [findings, setFindings] = useState([]);
  const [gsc, setGsc] = useState(null);              // null loading | false none | row
  const [pageRows, setPageRows] = useState([]);
  const [sites, setSites] = useState(null);          // null hidden | [] loading | [urls]
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const pollRef = useRef(null);

  const loadProp = async () => {
    const { data } = await supabase.from('organic_properties').select('*')
      .eq('org_id', effectiveOrgId).order('created_at').limit(1);
    const p = data?.[0] || null;
    setProp(p);
    return p;
  };
  const loadAudit = async (propertyId) => {
    const { data: pr } = await supabase.from('organic_pages').select('*').eq('property_id', p.id);
    setPageRows(pr || []);
    const { data: audits } = await supabase.from('organic_audits').select('*')
      .eq('property_id', propertyId).eq('status', 'complete')
      .order('created_at', { ascending: false }).limit(1);
    const a = audits?.[0] || null;
    setAudit(a);
    if (a) {
      onScore(a.score);
      const { data: f } = await supabase.from('organic_findings').select('*').eq('audit_id', a.id).order('sort_order');
      setFindings(f || []);
    } else setFindings([]);
  };
  const loadGsc = async () => {
    const { data } = await supabase.from('gsc_connections').select('*')
      .eq('org_id', effectiveOrgId).neq('status', 'revoked')
      .order('created_at', { ascending: false }).limit(1);
    setGsc(data?.[0] || false);
  };

  useEffect(() => {
    if (!effectiveOrgId) return;
    (async () => {
      const p = await loadProp();
      if (p?.status === 'ready') await loadAudit(p.id);
      if (p?.status === 'crawling') startPolling(p.id);
      loadGsc();
    })();
    return () => clearInterval(pollRef.current);
  }, [effectiveOrgId]); // eslint-disable-line

  const startPolling = (propertyId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const { data } = await supabase.from('organic_properties').select('*').eq('id', propertyId).single();
      setProp(data);
      if (data?.status === 'ready') { clearInterval(pollRef.current); await loadAudit(propertyId); setBusy(null); }
      if (data?.status === 'error') { clearInterval(pollRef.current); setErr(data.status_detail || 'Crawl failed.'); setBusy(null); }
    }, 2500);
  };

  const crawl = async (siteUrl) => {
    setBusy('crawl'); setErr(null);
    try {
      // background function: returns 202 immediately; we poll the property row.
      // On a first-ever crawl the row is created by the function itself, so retry
      // the lookup a few times before giving up on attaching the poller.
      await api('organic-crawl-background', { method: 'POST', body: siteUrl ? { site_url: siteUrl } : { property_id: prop.id } }).catch(() => {});
      let tries = 0;
      const attach = async () => {
        const p = await loadProp();
        if (p) { startPolling(p.id); return; }
        if (++tries < 6) setTimeout(attach, 1500);
        else { setErr('The crawl didn\u2019t start — check the URL and try again.'); setBusy(null); }
      };
      setTimeout(attach, 1200);
    } catch (e) { setErr(e.message); setBusy(null); }
  };

  const rescore = async () => {
    setBusy('rescore'); setErr(null);
    try { await api('run-organic-audit', { method: 'POST', body: { property_id: prop.id } }); await loadAudit(prop.id); }
    catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  const connectGsc = async () => {
    setBusy('gsc');
    try { const { url } = await api('google-oauth-start?product=gsc'); window.location.href = url; }
    catch (e) { setErr(e.message); setBusy(null); }
  };
  const syncGsc = async () => {
    setBusy('gsync'); setErr(null);
    try { await api('gsc-sync', { method: 'POST', body: {} }); await loadGsc(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };
  const openSwitcher = async () => {
    setSites([]); setErr(null);
    try { const r = await api('gsc-sites'); setSites(r.sites || []); }
    catch (e) { setErr(e.message); setSites(null); }
  };
  const switchSite = async (site_url) => {
    setBusy('gswitch'); setErr(null);
    try {
      await api('gsc-sync', { method: 'POST', body: { site_url } });
      await loadGsc(); setSites(null);
      if (audit) setToastLocal('Property switched and synced — hit Re-score to fold the new queries into the audit.');
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };
  const [localToast, setToastLocal] = useState(null);

  if (prop === undefined) return <SkPage cards={2} />;

  if (!prop) {
    return (
      <div className="section" style={{ maxWidth: 620 }}>
        <h2>Point Clarify at your site</h2>
        <p className="muted" style={{ margin: '6px 0 14px' }}>
          We crawl your key pages — money pages first — and score the twelve things that decide whether you earn clicks: indexability, titles, content depth, internal links, AI-answer readiness, and more.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="yourbusiness.com" value={siteInput} onChange={(e) => setSiteInput(e.target.value)}
            style={{ flex: 1, minWidth: 220 }} onKeyDown={(e) => e.key === 'Enter' && siteInput && crawl(siteInput)} />
          <button className="btn primary" disabled={!siteInput || busy || supportView} onClick={() => crawl(siteInput)}>
            {busy ? 'Crawling…' : 'Crawl & audit'}
          </button>
        </div>
        {err && <div className="banner err" style={{ marginTop: 12 }}>{err}</div>}
      </div>
    );
  }

  const crawling = prop.status === 'crawling' || busy === 'crawl';

  return (
    <>
      <div className="row-between" style={{ marginTop: 4 }}>
        <p className="muted" style={{ margin: 0 }}>
          <span className="mono">{prop.site_url.replace(/^https?:\/\//, '')}</span>
          {prop.last_crawled_at && <> · {prop.pages_crawled} pages · crawled {timeAgo(prop.last_crawled_at)}</>}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <ViewSeg view={view} setView={setView} />
          <button className="btn ghost small" disabled={crawling || busy === 'rescore' || supportView || !audit} onClick={rescore}
            title="Re-score the stored crawl with current model weights + Search Console data">
            {busy === 'rescore' ? 'Scoring…' : 'Re-score'}
          </button>
          <button className="btn primary" disabled={crawling || supportView} onClick={() => crawl()}>
            {crawling ? 'Crawling…' : audit ? 'Re-crawl & audit' : 'Crawl & audit'}
          </button>
        </div>
      </div>
      {err && <div className="banner err">{err}</div>}
      {crawling && (
        <div className="banner trial">Crawling {prop.site_url.replace(/^https?:\/\//, '')} — money pages first. This usually takes under a minute.</div>
      )}

      {audit?.sub?.scores && (
        <div className="section" style={{ padding: '18px 20px 26px' }}>
          <div className="inst" style={{ paddingBottom: 22 }}>
            <Ring score={audit.sub.scores.foundation} channel="organic" size={76} cap="Foundation" />
            <Ring score={audit.sub.scores.demand} channel="paid" size={76} cap="Demand capture" />
            <Ring score={audit.sub.scores.coverage} size={76} cap="Money pages" />
            <Ring score={audit.sub.scores.ai} channel="both" size={76} cap="AI readiness" />
            <div className="divider" />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="valstrip">
                {audit.sub.pipeline_value
                  ? <span><span className="money">{usdN(Math.round(audit.sub.pipeline_value))}/mo</span> of demand identified</span>
                  : <span>Demand pricing unlocks with Search Console</span>}
              </div>
              <p className="muted" style={{ margin: '6px 0 8px' }}>
                Priced at <span className="mono">${Number(audit.sub.value_per_click).toFixed(2)}</span>/click
                {audit.sub.vpc_source === 'paid' ? ' — your real paid CPC' : ' (default)'}
                {' '}· model v{audit.sub.model_version}
              </p>
              <Link to="/playbook" className="btn small primary" style={{ textDecoration: 'none' }}>Open the Playbook →</Link>
            </div>
          </div>
        </div>
      )}

      <div className="section" style={{ padding: 16 }}>
        <div className="row-between">
          <div>
            <h3>Search Console</h3>
            {gsc === null ? <p className="muted" style={{ margin: '4px 0 0' }}>Checking…</p>
              : !gsc ? <p className="muted" style={{ margin: '4px 0 0' }}>Connect it and the audit gains real queries: striking-distance terms, under-clicked rankings, and the overlap view.</p>
              : gsc.status === 'error' ? <p className="muted" style={{ margin: '4px 0 0', color: 'var(--act)' }}>{gsc.status_detail || 'Connection error'}</p>
              : <p className="muted" style={{ margin: '4px 0 0' }}><span className="mono">{gsc.site_url}</span> · synced {timeAgo(gsc.last_synced_at)}</p>}
          </div>
          {gsc === false
            ? <button className="btn org small" disabled={busy === 'gsc' || supportView} onClick={connectGsc}>{busy === 'gsc' ? 'Redirecting…' : 'Connect Search Console'}</button>
            : gsc && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn ghost small" disabled={supportView || sites !== null} onClick={openSwitcher}>Change property</button>
                <button className="btn ghost small" disabled={busy === 'gsync' || supportView} onClick={syncGsc}>{busy === 'gsync' ? 'Syncing…' : 'Sync now'}</button>
              </div>
            )}
        </div>
        {sites !== null && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            {sites.length === 0 ? <span className="muted">Loading your Search Console properties…</span> : (
              <>
                <select style={{ width: 'auto', maxWidth: '100%' }} value={gsc?.site_url || ''} disabled={busy === 'gswitch'}
                  onChange={(e) => e.target.value && e.target.value !== gsc?.site_url && switchSite(e.target.value)}>
                  {!sites.includes(gsc?.site_url) && <option value="">Pick a property…</option>}
                  {sites.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <button className="btn ghost small" onClick={() => setSites(null)}>Cancel</button>
                {busy === 'gswitch' && <span className="muted">Switching & syncing…</span>}
              </>
            )}
          </div>
        )}
        {localToast && <div className="banner ok" style={{ marginTop: 12, marginBottom: 0 }}>{localToast}</div>}
      </div>

      {!audit && !crawling
        ? <Empty title="No organic audit yet">Crawl the site — it takes under a minute and scores the full playbook of checks.</Empty>
        : audit && <FindingGroups {...{ findings, view, supportView, profile, setFindings }} table="organic_findings" />}

      {audit && pageRows.length > 0 && <MoneyMap pageRows={pageRows} />}
    </>
  );
}

// ---------- OVERVIEW: the whole search program on one screen ----------
function OverviewTab({ setTab }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const pull = () => { setErr(null); setData(null); api('search-overview').then(setData).catch((e) => setErr(e.message)); };
  useEffect(() => { pull(); }, []); // eslint-disable-line
  if (err) return (
    <div className="banner err" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>{err}</span><button className="btn small ghost" onClick={pull}>Retry</button>
    </div>
  );
  if (!data) return <SkPage rings={3} cards={4} />;

  const { scores, ledger, terms, verdict_counts, rules, connected } = data;
  const totalClicks = ledger.paid_clicks + ledger.organic_clicks;
  const paidShare = totalClicks ? Math.round((ledger.paid_clicks / totalClicks) * 100) : 0;
  const fmt$ = (micros) => `$${Math.round(micros / 1e6).toLocaleString('en-US')}`;

  return (
    <>
      <div className="section">
        <div className="inst" style={{ paddingBottom: 22 }}>
          <Ring score={scores.blended} channel="both" size={112} cap="Search program" />
          <div className="divider" />
          <Ring score={scores.paid} channel="paid" size={76} cap="Paid" />
          <Ring score={scores.organic} channel="organic" size={76} cap="Organic" />
          <div style={{ flex: 1, minWidth: 230 }}>
            <h2 style={{ fontSize: 18 }}>One results page. Two ways in. One program.</h2>
            <p className="muted" style={{ margin: '6px 0 10px' }}>
              The blended score weighs both channels equally — the deep dives live in the tabs above.
            </p>
            <div className="mixbar" style={{ maxWidth: 340 }} role="img"
              aria-label={`Click mix: ${paidShare}% paid, ${100 - paidShare}% organic`}>
              <i style={{ width: `${paidShare}%`, background: 'var(--paid)' }} />
              <i style={{ width: `${100 - paidShare}%`, background: 'var(--org)' }} />
            </div>
            <p className="faint" style={{ margin: '6px 0 0' }}>
              click mix · <span style={{ color: 'var(--paid)' }}>{paidShare}% bought</span> · <span style={{ color: 'var(--org)' }}>{100 - paidShare}% earned</span>
            </p>
          </div>
        </div>
      </div>

      {(!connected.paid || !connected.organic) && (
        <div className="banner trial">
          {!connected.paid && <>Google Ads isn&rsquo;t connected — the ledger is organic-only. <Link to="/onboarding">Connect it →</Link> </>}
          {!connected.organic && <>Search Console isn&rsquo;t connected — earned clicks are invisible. <button className="btn small ghost" onClick={() => setTab('organic')}>Connect on the Organic tab</button></>}
        </div>
      )}

      <div className="grid stagger">
        <div className="card" style={{ '--i': 0 }}>
          <div className="label">Clicks bought (30d)</div>
          <div className="big" style={{ color: 'var(--paid)' }}><Num v={ledger.paid_clicks} /></div>
          <div className="muted">{fmt$(ledger.paid_cost_micros)} spent</div>
        </div>
        <div className="card" style={{ '--i': 1 }}>
          <div className="label">Clicks earned (28d)</div>
          <div className="big" style={{ color: 'var(--org)' }}><Num v={ledger.organic_clicks} /></div>
          <div className="muted">from rankings — no invoice</div>
        </div>
        <div className="card" style={{ '--i': 2 }}>
          <div className="label">Earned-media value</div>
          <div className="big" style={{ color: 'var(--org)' }}><Num v={Math.round(ledger.earned_value_micros / 1e6)} f={(x) => `$${x.toLocaleString('en-US')}`} /></div>
          <div className="muted">what those clicks cost at {ledger.cpc_source === 'paid' ? 'your real' : 'a default'} ${(ledger.cpc_micros / 1e6).toFixed(2)} CPC</div>
        </div>
        <div className="card" style={{ '--i': 3 }}>
          <div className="label">Pipeline identified</div>
          <div className="big" style={{ color: 'var(--paid)' }}>{ledger.pipeline_value ? <Num v={Math.round(ledger.pipeline_value)} f={(x) => `$${x.toLocaleString('en-US')}`} /> : '—'}</div>
          <div className="muted">{ledger.pipeline_value ? <>organic demand, priced — <Link to="/playbook" style={{ color: 'var(--org)' }}>Playbook →</Link></> : 'run the organic audit to price the gaps'}</div>
        </div>
      </div>

      {terms.length > 0 && (
        <div className="section">
          <div className="row-between">
            <h2>Term intelligence</h2>
            <div className="valstrip">
              {Object.entries(verdict_counts).map(([k, n]) => <span key={k} className={`verd ${k}`}>{k.replace('_', ' ')} {n}</span>)}
            </div>
          </div>
          <p className="muted" style={{ margin: '4px 0 10px' }}>Every meaningful term, both channels side by side. The verdict rules print in the math below.</p>
          <div className="tablewrap">
            <table className="plain">
              <thead><tr><th>Term</th><th>Verdict</th><th style={{ textAlign: 'right' }}>Paid cost</th><th style={{ textAlign: 'right' }}>Paid clicks</th><th style={{ textAlign: 'right' }}>Conv</th><th style={{ textAlign: 'right' }}>Org pos</th><th style={{ textAlign: 'right' }}>Org clicks</th></tr></thead>
              <tbody>
                {terms.slice(0, 25).map((r) => (
                  <tr key={r.term}>
                    <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.term}</td>
                    <td>{r.verdict ? <span className={`verd ${r.verdict}`}>{r.verdict.replace('_', ' ')}</span> : <span className="faint">—</span>}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.paid ? fmt$(r.paid.cost) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.paid ? r.paid.clicks.toLocaleString() : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.paid ? r.paid.conv : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.organic ? r.organic.position : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.organic ? r.organic.clicks.toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ShowMath evidence={{
            window: 'Paid: last 30d terms · Organic: last 28d queries',
            formula: Object.entries(rules).map(([k, v]) => `${k} = ${v}`).join('\n'),
            inputs: { terms_joined: terms.length, cpc_used: `$${(ledger.cpc_micros / 1e6).toFixed(2)} (${ledger.cpc_source})` },
            result: verdict_counts,
          }} />
        </div>
      )}
    </>
  );
}

// Every crawled page, graded on the five things that decide whether it can earn.
function MoneyMap({ pageRows }) {
  const model = buildModel(pageRows.map(rowToPage));
  const rank = { home: 0, money: 1, content: 2, trust: 3, other: 4, utility: 5 };
  const sorted = [...model.pages].sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.path.localeCompare(b.path));
  const shortPath = (u) => { try { const p = new URL(u).pathname; return p.length > 1 ? p : '/'; } catch { return u; } };
  return (
    <div className="section">
      <div className="row-between">
        <h2>Money map</h2>
        <span className="faint">indexed · titled · substantial · linked · answerable</span>
      </div>
      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table className="plain">
          <thead><tr><th>Page</th><th>Role</th><th>Grade</th><th>Words</th><th>Links in</th><th>Depth</th><th>Flags</th></tr></thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.url}>
                <td className="mono" style={{ fontSize: 12.5 }}>{shortPath(p.url)}</td>
                <td><span className={`pill ${p.role}`}>{p.role}</span></td>
                <td><strong className={`grade${p.grade.letter[0]}`}>{p.grade.letter}</strong></td>
                <td className="mono">{(p.word_count || 0).toLocaleString()}</td>
                <td className="mono">{p.inbound}</td>
                <td className="mono">{p.depth ?? '—'}</td>
                <td className="faint">
                  {[p.noindex && 'noindex', !p.title && 'no title', p.role === 'money' && p.word_count < 300 && 'thin', !p.grade.checks.answerable && 'no answer capsule'].filter(Boolean).join(' · ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {model.competition.length > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          <strong style={{ color: 'var(--watch)' }}>Internal competition:</strong>{' '}
          {model.competition.slice(0, 4).map((c) => `${c.a} ↔ ${c.b}`).join(' · ')} — near-identical topics splitting signals.
        </p>
      )}
    </div>
  );
}

// ---------- OVERLAP ----------
function OverlapTab({ effectiveOrgId, setTab }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!effectiveOrgId) return;
    setData(null); setErr(null);
    api('search-insights', { method: 'POST', body: {} })
      .then(setData).catch((e) => setErr(e.message));
  }, [effectiveOrgId]);

  if (err) return <div className="banner err" style={{ marginTop: 16 }}>{err}</div>;
  if (!data) return <SkPage cards={4} />;

  const { summary, findings, sources } = data;
  const missing = [];
  if (!sources.paid_connected) missing.push({ text: 'Connect Google Ads to see the terms you\u2019re paying for.', to: '/onboarding', label: 'Connect Google Ads' });
  if (!sources.gsc_connected) missing.push({ text: 'Connect Search Console to see the queries you already rank for.', action: () => setTab('organic'), label: 'Open Organic tab' });
  if (!sources.crawl_ready) missing.push({ text: 'Crawl your site so content gaps can be checked against real pages.', action: () => setTab('organic'), label: 'Crawl site' });

  return (
    <>
      <p className="muted" style={{ marginTop: 4 }}>
        {summary.paid_terms.toLocaleString()} paid terms × {summary.organic_queries.toLocaleString()} organic queries. This is the view neither Google dashboard will show you.
      </p>
      {missing.length > 0 && (
        <div className="section" style={{ padding: 16 }}>
          {missing.map((m, i) => (
            <div key={i} className="row-between" style={{ padding: '6px 0' }}>
              <span className="muted">{m.text}</span>
              {m.to
                ? <Link to={m.to} className="btn ghost small" style={{ textDecoration: 'none' }}>{m.label}</Link>
                : <button className="btn ghost small" onClick={m.action}>{m.label}</button>}
            </div>
          ))}
        </div>
      )}

      {(sources.paid_connected || sources.gsc_connected) && (
        <div className="grid">
          <div className="card">
            <div className="label">Overlap spend / 30d</div>
            <div className="big" style={{ color: summary.overlap_spend_micros > 0 ? 'var(--paid)' : undefined }}>{usd(summary.overlap_spend_micros)}</div>
            <div className="muted">paid clicks on terms you rank top-3 for</div>
          </div>
          <div className="card">
            <div className="label">Est. reclaimable</div>
            <div className="big" style={{ color: summary.reclaimable_micros > 0 ? 'var(--org)' : undefined }}>{usd(summary.reclaimable_micros)}</div>
            <div className="muted">redeployable to terms you don&rsquo;t rank for</div>
          </div>
          <div className="card">
            <div className="label">Content gaps</div>
            <div className="big">{summary.content_gaps}</div>
            <div className="muted">paid-proven winners with no page</div>
          </div>
          <div className="card">
            <div className="label">Organic-only wins</div>
            <div className="big">{summary.free_wins}</div>
            <div className="muted">rankings carrying weight for free</div>
          </div>
        </div>
      )}

      {findings.length === 0 && missing.length === 0 && (
        <Empty title="No cross-channel findings yet">Both sources are connected — as data accrues, overlap, gaps, and free wins will surface here.</Empty>
      )}
      {findings.map((f, i) => (
        <div key={i} className="card" style={{ marginTop: 12 }}>
          <div><Chip severity={f.severity} /> <strong style={{ marginLeft: 6 }}>{f.title}</strong></div>
          <p style={{ margin: '8px 0 0' }}>{f.summary}</p>
          {f.recommendation && <p className="muted" style={{ margin: '6px 0 0' }}><strong>Do this:</strong> {f.recommendation}</p>}
          <ShowMath evidence={f.evidence} />
        </div>
      ))}
    </>
  );
}
