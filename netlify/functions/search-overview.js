// GET/POST -> the holistic view of the search program: one blended score, the
// Search Ledger (what you spend vs what organic earns you at your real CPC),
// channel mix, and Term Intelligence — every meaningful term with both channels
// side by side and a verdict: defend / harvest / fill the gap / trim.
// Same evidence-first spirit: the verdict rules print with the response.
const { getCaller, admin, json } = require('./_shared/util');
const { loadModelSettings } = require('./_shared/model-settings');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {};
  const db = admin();

  // scope: own org, or (admin) any connection's org
  let conn = null;
  if (body.connection_id && caller.profile.is_clarify_admin) {
    conn = (await db.from('google_ads_connections').select('*').eq('id', body.connection_id).single()).data;
  } else {
    conn = (await db.from('google_ads_connections').select('*')
      .eq('org_id', caller.profile.org_id).eq('status', 'active').limit(1)).data?.[0] || null;
  }
  const orgId = conn?.org_id || caller.profile.org_id;

  const settings = await loadModelSettings(db, orgId);
  const t = settings.weights.thresholds;

  const [terms, gscConn, paidAudit, orgAudit] = await Promise.all([
    conn ? db.from('search_term_stats').select('term, cost_micros, clicks, conversions').eq('connection_id', conn.id).limit(3000) : { data: [] },
    db.from('gsc_connections').select('id, site_url').eq('org_id', orgId).eq('status', 'active').limit(1),
    conn ? db.from('audits').select('score').eq('connection_id', conn.id).eq('status', 'complete').order('created_at', { ascending: false }).limit(1) : { data: [] },
    db.from('organic_audits').select('score, sub').eq('org_id', orgId).eq('status', 'complete').order('created_at', { ascending: false }).limit(1),
  ]);

  let queries = [];
  if (gscConn.data?.length) {
    const { data: q } = await db.from('gsc_query_stats')
      .select('query, clicks, impressions, ctr, position').eq('connection_id', gscConn.data[0].id).limit(3000);
    queries = q || [];
  }

  // ---- ledger ----
  const paidClicks = (terms.data || []).reduce((s, x) => s + Number(x.clicks || 0), 0);
  const paidCost = (terms.data || []).reduce((s, x) => s + Number(x.cost_micros || 0), 0);
  const orgClicks = queries.reduce((s, q) => s + Number(q.clicks || 0), 0);
  const cpc = paidClicks >= 30 ? paidCost / paidClicks : (t.value_per_click_default ?? 4) * 1e6;
  const earnedValue = Math.round(orgClicks * cpc); // micros: what those clicks would have cost

  // ---- blended score ----
  const paidScore = paidAudit.data?.[0]?.score ?? null;
  const orgScore = orgAudit.data?.[0]?.score ?? null;
  const blended = paidScore != null && orgScore != null
    ? Math.round(paidScore * 0.5 + orgScore * 0.5)
    : paidScore ?? orgScore ?? null;

  // ---- term intelligence: join paid terms x organic queries ----
  const orgMap = new Map();
  for (const q of queries) {
    const k = norm(q.query);
    const prev = orgMap.get(k);
    if (!prev || q.impressions > prev.impressions) orgMap.set(k, q);
  }
  const rows = [];
  const seen = new Set();
  for (const x of (terms.data || [])) {
    const k = norm(x.term);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const o = orgMap.get(k);
    rows.push({
      term: x.term,
      paid: { clicks: Number(x.clicks || 0), cost: Number(x.cost_micros || 0), conv: Number(x.conversions || 0) },
      organic: o ? { clicks: Math.round(o.clicks), position: Math.round(o.position * 10) / 10, impressions: Math.round(o.impressions) } : null,
    });
  }
  for (const [k, o] of orgMap) {
    if (seen.has(k)) continue;
    rows.push({ term: o.query, paid: null, organic: { clicks: Math.round(o.clicks), position: Math.round(o.position * 10) / 10, impressions: Math.round(o.impressions) } });
  }

  // verdicts — the rules print below so the table can explain itself
  const topPos = t.organic_top_position ?? 3;
  for (const r of rows) {
    const p = r.paid, o = r.organic;
    if (p && o && o.position <= topPos && p.cost > 0) r.verdict = 'harvest';        // rank top-N and still paying
    else if (p && p.conv > 0 && (!o || o.position > 10)) r.verdict = 'fill_gap';    // paid proves demand, organic absent
    else if (o && o.position <= topPos && (!p || p.cost === 0)) r.verdict = 'defend'; // free wins worth protecting
    else if (p && p.cost >= 25e6 && p.conv === 0) r.verdict = 'trim';               // spend, no results, no organic backup
    else r.verdict = null;
  }
  rows.sort((a, b) => ((b.paid?.cost || 0) + (b.organic?.clicks || 0) * cpc) - ((a.paid?.cost || 0) + (a.organic?.clicks || 0) * cpc));

  const counts = rows.reduce((m, r) => { if (r.verdict) m[r.verdict] = (m[r.verdict] || 0) + 1; return m; }, {});

  return json(200, {
    connected: { paid: !!conn, organic: !!gscConn.data?.length },
    scores: { paid: paidScore, organic: orgScore, blended },
    ledger: {
      paid_clicks: paidClicks, paid_cost_micros: paidCost,
      organic_clicks: orgClicks, earned_value_micros: earnedValue,
      cpc_micros: Math.round(cpc), cpc_source: paidClicks >= 30 ? 'paid' : 'default',
      pipeline_value: orgAudit.data?.[0]?.sub?.pipeline_value ?? null,
    },
    terms: rows.slice(0, 60),
    verdict_counts: counts,
    rules: {
      harvest: `organic position ≤ ${topPos} while still paying for the same term`,
      fill_gap: 'paid converts on the term but organic is absent or page-two',
      defend: `organic position ≤ ${topPos} with no paid spend — a free win to protect`,
      trim: 'meaningful spend, zero conversions, no organic backup',
    },
  });
};
