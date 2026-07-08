// POST { connection_id?, property_id? } (Bearer) -> the Strategist Brief.
// Gathers BOTH audits + the overlap view, then writes a cross-channel action plan
// through Claude — steered by Cameron's model weights and analyst notes, and
// forbidden from inventing numbers: it may only use the evidence handed to it.
const { getCaller, admin, json } = require('./_shared/util');
const { runOverlap } = require('./_shared/overlap-engine');
const { loadModelSettings } = require('./_shared/model-settings');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'AI briefs aren\u2019t configured on this deployment yet.' });
  const { connection_id, property_id } = JSON.parse(event.body || '{}');
  const orgId = caller.profile.org_id;
  const db = admin();

  // ---- paid: latest complete audit + totals ----
  let connQ = db.from('google_ads_connections').select('id, org_id, descriptive_name').eq('status', 'active');
  if (connection_id) connQ = connQ.eq('id', connection_id);
  if (!caller.profile.is_clarify_admin) connQ = connQ.eq('org_id', orgId);
  const { data: conns } = await connQ.order('created_at').limit(1);
  const conn = conns?.[0] || null;
  const scopeOrg = conn?.org_id || orgId;

  let paid = null, terms = [];
  if (conn) {
    const { data: audits } = await db.from('audits').select('id, score, created_at')
      .eq('connection_id', conn.id).eq('status', 'complete')
      .order('created_at', { ascending: false }).limit(1);
    if (audits?.length) {
      const { data: fs } = await db.from('audit_findings')
        .select('category, severity, title, summary, recommendation')
        .eq('audit_id', audits[0].id).neq('severity', 'pass').eq('status', 'open')
        .order('sort_order').limit(8);
      paid = { score: audits[0].score, account: conn.descriptive_name, findings: fs || [] };
    }
    const { data: t } = await db.from('search_term_stats')
      .select('term, cost_micros, clicks, conversions').eq('connection_id', conn.id).limit(3000);
    terms = t || [];
  }

  // ---- organic: latest complete audit ----
  let propQ = db.from('organic_properties').select('id, site_url').eq('org_id', scopeOrg);
  if (property_id) propQ = db.from('organic_properties').select('id, site_url').eq('id', property_id);
  const { data: props } = await propQ.order('created_at').limit(1);
  const prop = props?.[0] || null;
  let organic = null, pages = [];
  if (prop) {
    const { data: oa } = await db.from('organic_audits').select('id, score, sub')
      .eq('property_id', prop.id).eq('status', 'complete')
      .order('created_at', { ascending: false }).limit(1);
    if (oa?.length) {
      const { data: ofs } = await db.from('organic_findings')
        .select('category, severity, title, summary, recommendation')
        .eq('audit_id', oa[0].id).neq('severity', 'pass').eq('status', 'open')
        .order('sort_order').limit(8);
      organic = { score: oa[0].score, site: prop.site_url, findings: ofs || [] };
    }
    const { data: pg } = await db.from('organic_pages').select('url, path, title, h1, status_code').eq('property_id', prop.id);
    pages = (pg || []).map((p) => ({ ...p, failed: !p.status_code || p.status_code >= 400 }));
  }

  // ---- overlap ----
  const { data: gscConns } = await db.from('gsc_connections').select('id')
    .eq('org_id', scopeOrg).eq('status', 'active').limit(1);
  let queries = [];
  if (gscConns?.length) {
    const { data: qs } = await db.from('gsc_query_stats')
      .select('query, page, clicks, impressions, ctr, position')
      .eq('connection_id', gscConns[0].id).limit(1500);
    queries = qs || [];
  }
  const settings = await loadModelSettings(db, scopeOrg);
  const overlap = (terms.length || queries.length)
    ? runOverlap({ terms, queries, pages, weights: settings.weights })
    : null;

  if (!paid && !organic) return json(409, { error: 'Run at least one audit first — the brief is built from audit evidence.' });

  const catWeights = settings.weights.categories;
  let playbook = null;
  if (prop) {
    const { data: oa2 } = await db.from('organic_audits').select('sub')
      .eq('property_id', prop.id).eq('status', 'complete')
      .order('created_at', { ascending: false }).limit(1);
    const sub = oa2?.[0]?.sub;
    if (sub) playbook = {
      top_tasks: sub.top_tasks || [], pipeline_value_month: sub.pipeline_value,
      value_per_click: sub.value_per_click, vpc_source: sub.vpc_source,
    };
  }
  const evidence = {
    paid, organic, playbook,
    overlap: overlap ? { summary: overlap.summary, findings: overlap.findings.map(({ evidence: _e, ...rest }) => rest) } : null,
  };

  const system = [
    'You are the strategist behind Clarify Search — one operator running both sides of the results page (Google Ads and SEO) for a small business.',
    'Voice: plain English, specific, calm, zero hype. Money talk is welcome. Never use the words "leverage", "utilize", "delve", or "holistic".',
    'HARD RULES: use ONLY numbers, findings, and terms present in the evidence JSON. Never invent metrics, dollar figures, or rankings. If a channel has no data, say so in one line and move on.',
    'The analyst notes below are the operator\u2019s standing guidance — treat them as priorities that shape ordering and emphasis, but never let them override the evidence.',
    'Category weights indicate how much the operator cares about each category (1 = neutral; higher = prioritize).',
    'Output format (markdown, no preamble, no code fences):',
    '## The read',
    'One short paragraph: the single most important thing across both channels right now.',
    '## This week',
    'When evidence.playbook.top_tasks exists, draw organic actions from it (it is already value-ranked).',
    '3–5 numbered actions. Each: **[Paid]**, **[Organic]**, or **[Both]** tag, the action in one sentence, then a dash and the expected effect grounded in the evidence.',
    '## Where the money moves',
    'One short paragraph on budget: reclaimable overlap spend, content gaps worth building, or "hold steady" if the evidence says so.',
    '## Watchlist',
    '2–3 one-line items to re-check next audit.',
  ].join('\n');

  const notesBlock = [
    settings.notes.global ? `GLOBAL ANALYST NOTES:\n${settings.notes.global}` : null,
    Object.entries(settings.notes.categories || {}).filter(([, v]) => v)
      .map(([k, v]) => `NOTE on ${k}: ${v}`).join('\n') || null,
  ].filter(Boolean).join('\n\n') || '(no analyst notes set)';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 900,
      system,
      messages: [{
        role: 'user',
        content: `${notesBlock}\n\nCATEGORY WEIGHTS: ${JSON.stringify(catWeights)}\n\nEVIDENCE:\n${JSON.stringify(evidence)}`,
      }],
    }),
  });
  if (!res.ok) {
    const e = await res.text().catch(() => '');
    return json(502, { error: `AI request failed (${res.status}). ${e.slice(0, 140)}` });
  }
  const data = await res.json();
  const brief = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!brief) return json(502, { error: 'The model returned nothing — try again.' });

  const { data: saved } = await db.from('ai_briefs').insert({
    org_id: scopeOrg, connection_id: conn?.id || null, property_id: prop?.id || null,
    brief_md: brief, model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    model_version: settings.version, created_by: caller.user.id,
  }).select().single();
  return json(200, { id: saved?.id, brief_md: brief, model_version: settings.version, created_at: saved?.created_at });
};
