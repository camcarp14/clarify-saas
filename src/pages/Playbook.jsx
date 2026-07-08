import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { usePref } from '../lib/usePref';
import { PillarTag, CopyBtn, Artifact, Empty, Expand, SkPage, useToast } from '../components/ui';
import { buildModel } from '../engine/model.js';
import { buildHolisticTasks, packSprint, sprintMarkdown } from '../engine/sprint.js';
import { forgeTitles, forgeSchema, forgeLinks, forgeBrief, forgeRedirects } from '../engine/forge.js';
import { rowToPage } from '../engine/rows.js';
import { tokens, overlap } from '../engine/parse.js';
import { usd } from '../engine/ctr.js';

// The Playbook — where the organic audit becomes a work plan.
// Every task is priced (at the org's REAL paid CPC when connected), sized, and
// ships its fix: rewritten titles, paste-ready schema, exact link placements,
// full content briefs. Slide the hours budget; the sprint repacks live.
export default function Playbook() {
  const { effectiveOrgId, supportView, org } = useAuth();
  const [prop, setProp] = useState(undefined);          // undefined loading | null none | row
  const [audit, setAudit] = useState(null);
  const [findings, setFindings] = useState([]);
  const [pageRows, setPageRows] = useState([]);
  const [paidFindings, setPaidFindings] = useState([]);
  const [hours, setHours] = usePref('playbook.hours', 4);
  const [channel, setChannel] = usePref('playbook.channel', 'all');
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [showBacklog, setShowBacklog] = useState(false);
  const [openFix, setOpenFix] = useState(null);         // task id with fix panel open

  const load = async () => {
    const { data: props } = await supabase.from('organic_properties').select('*')
      .eq('org_id', effectiveOrgId).order('created_at').limit(1);
    const p = props?.[0] || null;
    setProp(p);
    if (!p) return;
    const { data: audits } = await supabase.from('organic_audits')
      .select('id, score, sub, created_at').eq('property_id', p.id).eq('status', 'complete')
      .order('created_at', { ascending: false }).limit(1);
    const a = audits?.[0] || null;
    setAudit(a);
    if (a) {
      const { data: fs } = await supabase.from('organic_findings').select('*')
        .eq('audit_id', a.id).order('sort_order');
      setFindings(fs || []);
    }
    const { data: pr } = await supabase.from('organic_pages').select('*').eq('property_id', p.id);
    setPageRows(pr || []);
  };
  const loadPaid = async () => {
    const { data: conns } = await supabase.from('google_ads_connections').select('id')
      .eq('org_id', effectiveOrgId).eq('status', 'active').limit(1);
    if (!conns?.length) { setPaidFindings([]); return; }
    const { data: audits } = await supabase.from('audits').select('id')
      .eq('connection_id', conns[0].id).eq('status', 'complete')
      .order('created_at', { ascending: false }).limit(1);
    if (!audits?.length) { setPaidFindings([]); return; }
    const { data: fs } = await supabase.from('audit_findings').select('*').eq('audit_id', audits[0].id);
    setPaidFindings(fs || []);
  };
  useEffect(() => { if (effectiveOrgId) { load(); loadPaid(); } }, [effectiveOrgId]); // eslint-disable-line

  const model = useMemo(() => pageRows.length ? buildModel(pageRows.map(rowToPage)) : null, [pageRows]);
  const tasks = useMemo(() => buildHolisticTasks({
    organicFindings: findings.filter((f) => f.status === 'open'),
    paidFindings: paidFindings.filter((f) => f.status === 'open'),
  }), [findings, paidFindings]);
  const shown = useMemo(() => channel === 'all' ? tasks : tasks.filter((t) => channel === 'paid' ? t.pillar === 'paid' : t.pillar !== 'paid'), [tasks, channel]);
  const packed = useMemo(() => packSprint(shown, hours), [shown, hours]);
  const md = useMemo(() => prop ? sprintMarkdown(packed, prop.site_url) : '', [packed, prop]);

  const refresh = async () => {
    setBusy('refresh'); setErr(null);
    try { await api('run-organic-audit', { method: 'POST', body: { property_id: prop.id } }); await load(); toast('Analysis refreshed — re-priced at your latest data.'); }
    catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  if (prop === undefined) return <SkPage rings={0} cards={0} />;
  if (!prop || !audit) {
    return (
      <>
        <h1>Playbook</h1>
        <Empty title="Nothing to plan from yet">
          The Playbook builds your week from the audits — run the organic one first (it feeds the fixes),
          and the paid audit joins automatically. <Link to="/audit?tab=organic"><strong>Run the organic audit →</strong></Link>
        </Empty>
      </>
    );
  }

  const sub = audit.sub;
  const legacy = !sub; // audit predates the Playbook engine

  return (
    <>
      <div className="row-between">
        <h1>Playbook</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <CopyBtn text={md} label="Copy sprint as Markdown" />
          <Link to="/audit?tab=organic" className="btn small ghost" style={{ textDecoration: 'none' }}>Full audit</Link>
          <button className="btn primary small" disabled={busy === 'refresh' || supportView} onClick={refresh}
            title={supportView ? 'Read-only in support view' : 'Re-runs the analysis on the stored crawl — model weights, Search Console data, and your real CPC all refresh'}>
            {busy === 'refresh' ? 'Analyzing…' : 'Refresh analysis'}
          </button>
        </div>
      </div>
      <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
        Your whole search program&rsquo;s week — paid and organic in one queue for
        {' '}<span className="mono">{prop.site_url.replace(/^https?:\/\//, '')}</span>, ranked by dollars-at-stake
        per hour, with the fix drafted underneath every organic task.
      </p>

      {err && <div className="banner err" style={{ marginTop: 12 }}>{err}</div>}
      {legacy && (
        <div className="banner warn" style={{ marginTop: 12 }}>
          This audit predates the Playbook engine — hit <strong>Refresh analysis</strong> to price the findings and draft the fixes.
        </div>
      )}

      {sub && (
        <div className="valstrip" style={{ marginTop: 12 }}>
          {sub.pipeline_value ? <span><span className="money">{usd(sub.pipeline_value)}/mo</span> identified</span> : <span>No priced demand yet</span>}
          <span>·</span>
          <span>valued at <span className="mono">${Number(sub.value_per_click).toFixed(2)}</span>/click
            {sub.vpc_source === 'paid' ? ' — your account\u2019s real paid CPC' : ' (default — connect Google Ads to price at your real CPC)'}</span>
          <span>·</span>
          <span className="faint">model v{sub.model_version} · analyzed {timeAgo(audit.created_at)}</span>
        </div>
      )}
      {sub && !sub.clicks_month && (
        <p className="muted" style={{ marginTop: 8 }}>
          Search Console isn&rsquo;t feeding this yet — <Link to="/audit?tab=organic">connect it</Link> and the demand
          tasks (striking distance, under-clicked rankings, content gaps) join the sprint, priced.
        </p>
      )}

      <div className="section">
        <div className="row-between">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <h2>This week&rsquo;s sprint</h2>
            <div className="seg small" role="tablist" aria-label="Channel filter">
              {[['all', 'All'], ['paid', 'Paid'], ['organic', 'Organic']].map(([k, label]) => (
                <button key={k} role="tab" aria-selected={channel === k} className={channel === k ? 'on' : ''} onClick={() => setChannel(k)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="hours">
            <span className="mono faint">{packed.hours_used}h of</span>
            <input type="range" min={1} max={12} step={1} value={hours}
              onChange={(e) => setHours(Number(e.target.value))} aria-label="Hours budget" />
            <span className="mono">{hours}h budget</span>
          </div>
        </div>

        <div className="stagger">
        {packed.sprint.map((t, i) => (
          <div className="task" key={t.id} style={{ '--i': i }}>
            <div className="row-between">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono faint">{i + 1}.</span>
                <PillarTag pillar={t.pillar} />
                <strong>{t.title}</strong>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {t.value_month ? <span className="val">{usd(t.value_month)}/mo</span> : null}
                <span className="eff">{t.effort} · ~{t.hours}h</span>
              </div>
            </div>
            {t.do_this && <p className="muted" style={{ margin: '8px 0 0' }}><strong style={{ color: 'var(--ink)' }}>Do:</strong> {t.do_this}</p>}
            <div className="row-between" style={{ marginTop: 8 }}>
              <span className="faint">{t.pillar === 'paid' ? `Verify in Google Ads in ${t.recheck_days} days` : `Verify in Search Console in ${t.recheck_days} days`}</span>
              {t.pillar === 'paid'
                ? <Link to="/audit?tab=paid" className="btn small ghost" style={{ textDecoration: 'none' }}>Open in the Paid audit →</Link>
                : t.fix && model && (
                  <button className="btn small ghost" onClick={() => setOpenFix(openFix === t.id ? null : t.id)}>
                    {openFix === t.id ? 'Hide fix' : 'Open the fix ↓'}
                  </button>
                )}
            </div>
            {t.fix && model && t.pillar !== 'paid' && (
              <Expand open={openFix === t.id}>
                <FixPanel fix={t.fix} model={model} brandName={org?.name || ''} supportView={supportView} />
              </Expand>
            )}
          </div>
        ))}
        </div>
        {packed.sprint.length === 0 && (
          <p className="muted" style={{ marginTop: 10 }}>
            {tasks.length ? 'Nothing fits this budget — nudge the slider up.' : 'Nothing open — every finding is resolved or passing. Protect what\u2019s working.'}
          </p>
        )}

        {packed.backlog.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button className="btn small ghost" onClick={() => setShowBacklog(!showBacklog)}>
              {showBacklog ? 'Hide' : 'Show'} backlog ({packed.backlog.length})
            </button>
            {showBacklog && packed.backlog.map((t) => (
              <div key={t.id} className="row-between" style={{ borderBottom: '1px solid var(--line)', padding: '9px 2px' }}>
                <span className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><PillarTag pillar={t.pillar} /> {t.title}</span>
                <span className="mono faint" style={{ whiteSpace: 'nowrap' }}>{t.value_month ? `${usd(t.value_month)}/mo · ` : ''}{t.effort}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- the fix, rendered inline ---------------- */
function FixPanel({ fix, model, brandName, supportView }) {
  const opts = { brandName };
  if (fix.forge === 'titles') {
    const urls = new Set(fix.targets || []);
    for (const q of (fix.queries || [])) {
      const qt = tokens(q);
      const best = model.pages.map((p) => ({ p, s: overlap(qt, p.fingerprint) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 0.5) urls.add(best.p.url);
    }
    const titles = forgeTitles(model, [...urls], opts);
    if (!titles.length) return <NoFix />;
    return titles.map((t) => (
      <Artifact key={t.url} title={t.page}
        text={`<title>${t.after.title}</title>\n<meta name="description" content="${t.after.meta_description}">`}>
        <pre>
          <span className="before">{t.before.title}</span>{'\n'}
          <span className="after">{t.after.title}</span> <span className="faint">({t.after.length} chars)</span>{'\n\n'}
          <span className="faint">meta:</span> {t.after.meta_description}
          {t.note ? `\n\n// ${t.note}` : ''}
        </pre>
      </Artifact>
    ));
  }
  if (fix.forge === 'schema') {
    const schema = forgeSchema(model, opts);
    return (
      <>
        <Artifact title={`LocalBusiness JSON-LD · ${schema.local.placement}`}
          text={`<script type="application/ld+json">\n${JSON.stringify(schema.local.jsonld, null, 2)}\n</script>`} />
        {schema.faq.slice(0, 4).map((f) => (
          <Artifact key={f.url} title={`FAQPage JSON-LD · ${f.page}`}
            text={`<script type="application/ld+json">\n${JSON.stringify(f.jsonld, null, 2)}\n</script>`} />
        ))}
        <p className="faint" style={{ marginTop: 8 }}>{schema.note}</p>
      </>
    );
  }
  if (fix.forge === 'links') {
    const links = forgeLinks(model, fix.targets || []);
    if (!links.length) return <NoFix />;
    return links.map((l) => (
      <Artifact key={l.url} title={`Feed ${l.target}`} text={l.placements.map((p) => p.instruction).join('\n')} />
    ));
  }
  if (fix.forge === 'brief') {
    const specs = [];
    (fix.targets || []).forEach((u) => specs.push({ url: u }));
    (fix.queries || []).forEach((q, _, arr) => specs.push({ query: q, related: arr.filter((x) => x !== q) }));
    const seen = new Set();
    const briefs = [];
    for (const spec of specs) {
      const b = forgeBrief(model, spec, { ...opts, relatedQueries: spec.related });
      if (seen.has(b.for)) continue;
      seen.add(b.for); briefs.push(b);
      if (briefs.length >= 6) break;
    }
    if (!briefs.length) return <NoFix />;
    return (
      <>
        {briefs.map((b, i) => <BriefCard key={i} brief={b} supportView={supportView} />)}
        {specs.length > briefs.length && <p className="faint" style={{ marginTop: 8 }}>Showing the top {briefs.length} of {specs.length} — ship these, refresh, and the next set queues up.</p>}
      </>
    );
  }
  if (fix.forge === 'redirects') {
    const r = forgeRedirects(model.failed || []);
    if (!r.lines.length) return <NoFix />;
    return (
      <>
        <Artifact title="broken → live" text={r.lines.join('\n')} />
        <p className="faint" style={{ marginTop: 8 }}>{r.note}</p>
      </>
    );
  }
  return <NoFix />;
}
const NoFix = () => <p className="faint" style={{ marginTop: 10 }}>The pages behind this fix aren&rsquo;t in the stored crawl anymore — re-crawl from the Audit page and refresh.</p>;

const briefMd = (b) => [
  `# ${b.outline.h1}`, '',
  `**Opening (the answer capsule):** ${b.outline.opening}`, '',
  ...b.outline.h2s.map((h) => `## ${h}`), '',
  `- Proof: ${b.outline.proof}`,
  `- FAQ markup: ${b.outline.faq_block}`,
  `- Word target: ~${b.outline.word_target}`,
  b.outline.internal_links_in.length ? `- Link IN from: ${b.outline.internal_links_in.join(', ')}` : null,
  b.outline.internal_links_out.length ? `- Link OUT to: ${b.outline.internal_links_out.join(', ')}` : null,
].filter((x) => x != null).join('\n');

function BriefCard({ brief, supportView }) {
  const [state, setState] = useState({ loading: false, draft: null, err: null });
  const md = briefMd(brief);
  const draftIt = async () => {
    setState({ loading: true, draft: null, err: null });
    try {
      const { draft } = await api('ai-draft-page', { method: 'POST', body: { brief } });
      setState({ loading: false, draft, err: null });
    } catch (e) { setState({ loading: false, draft: null, err: e.message }); }
  };
  return (
    <div className="artifact">
      <div className="a-head">
        <span className="t">{brief.for}{brief.query ? ` · target: "${brief.query}"` : ''}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <CopyBtn text={md} label="Copy brief" />
          <button className="btn small ghost" disabled={state.loading || supportView} onClick={draftIt}>
            {state.loading ? 'Drafting…' : 'Draft with AI'}
          </button>
        </div>
      </div>
      <pre>{md}</pre>
      {state.err && <div className="banner warn" style={{ margin: 12 }}>{state.err}</div>}
      {state.draft && (
        <>
          <div className="a-head" style={{ borderTop: '1px dashed rgba(244,242,234,.14)' }}>
            <span className="t">AI draft — review before shipping</span><CopyBtn text={state.draft} />
          </div>
          <pre>{state.draft}</pre>
        </>
      )}
    </div>
  );
}
