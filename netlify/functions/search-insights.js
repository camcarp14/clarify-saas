// POST { connection_id?, property_id? } (Bearer) -> the holistic view:
// paid terms × organic queries × crawled pages through the overlap engine.
// Computed live — no table, no staleness.
const { getCaller, admin, json } = require('./_shared/util');
const { runOverlap } = require('./_shared/overlap-engine');
const { loadModelSettings } = require('./_shared/model-settings');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { connection_id, property_id } = JSON.parse(event.body || '{}');
  const orgId = caller.profile.org_id;
  const db = admin();
  const admined = caller.profile.is_clarify_admin;

  // paid terms (org's selected or first active connection)
  let connQ = db.from('google_ads_connections').select('id, org_id').eq('status', 'active');
  if (connection_id) connQ = connQ.eq('id', connection_id);
  if (!admined) connQ = connQ.eq('org_id', orgId);
  const { data: conns } = await connQ.order('created_at').limit(1);
  const conn = conns?.[0] || null;
  const scopeOrg = conn?.org_id || orgId;

  let terms = [];
  if (conn) {
    const { data: t } = await db.from('search_term_stats')
      .select('term, cost_micros, clicks, conversions').eq('connection_id', conn.id).limit(3000);
    terms = t || [];
  }

  // organic queries + crawled pages
  const { data: gscConns } = await db.from('gsc_connections').select('id')
    .eq('org_id', scopeOrg).eq('status', 'active').limit(1);
  let queries = [];
  if (gscConns?.length) {
    const { data: qs } = await db.from('gsc_query_stats')
      .select('query, page, clicks, impressions, ctr, position')
      .eq('connection_id', gscConns[0].id).limit(1500);
    queries = qs || [];
  }

  let propQ = db.from('organic_properties').select('id').eq('org_id', scopeOrg).eq('status', 'ready');
  if (property_id) propQ = db.from('organic_properties').select('id').eq('id', property_id);
  const { data: props } = await propQ.order('created_at').limit(1);
  let pages = [];
  if (props?.length) {
    const { data: pg } = await db.from('organic_pages')
      .select('url, path, title, h1, status_code').eq('property_id', props[0].id);
    pages = (pg || []).map((p) => ({ ...p, failed: !p.status_code || p.status_code >= 400 }));
  }

  const settings = await loadModelSettings(db, scopeOrg);
  const result = runOverlap({ terms, queries, pages, weights: settings.weights });
  return json(200, {
    ...result,
    sources: {
      paid_connected: !!conn, gsc_connected: !!gscConns?.length, crawl_ready: !!props?.length,
    },
  });
};
