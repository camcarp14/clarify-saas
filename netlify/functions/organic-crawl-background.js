// Background: crawl one property's site through the Playbook engine, store the
// richer page records, run the full priced analysis (foundation + AI readiness +
// Search-Console demand), and write findings + subscores. Client polls status.
// POST { site_url } (Bearer) or { property_id } (Bearer or x-internal-secret).
const { getCaller, admin, json } = require('./_shared/util');
const { crawlDeep, pageToRow, runPlaybook } = require('./_shared/playbook');

exports.handler = async (event) => {
  const internal = (event.headers['x-internal-secret'] || '') === process.env.INTERNAL_SYNC_SECRET;
  const caller = internal ? null : await getCaller(event);
  if (!internal && !caller) return json(401, { error: 'Not signed in' });

  const body = JSON.parse(event.body || '{}');
  const db = admin();

  let prop = null;
  if (body.property_id) {
    let q = db.from('organic_properties').select('*').eq('id', body.property_id);
    if (caller && !caller.profile.is_clarify_admin) q = q.eq('org_id', caller.profile.org_id);
    prop = (await q.single()).data;
  } else if (body.site_url && caller) {
    const site_url = normalizeSite(body.site_url);
    if (!site_url) return json(400, { error: 'That doesn\u2019t look like a public website URL. Try e.g. example.com' });
    const { data } = await db.from('organic_properties')
      .upsert({ org_id: caller.profile.org_id, site_url, created_by: caller.user.id }, { onConflict: 'org_id,site_url' })
      .select().single();
    prop = data;
  }
  if (!prop) return json(404, { error: 'Property not found' });

  await db.from('organic_properties').update({ status: 'crawling', status_detail: null }).eq('id', prop.id);

  try {
    const pages = await crawlDeep(prop.site_url, { maxPages: 14 });
    if (!pages.length) throw new Error('Could not fetch any pages — is the site up and public?');

    await db.from('organic_pages').delete().eq('property_id', prop.id);
    await db.from('organic_pages').insert(pages.map((p) => pageToRow(p, { org_id: prop.org_id, property_id: prop.id })));

    const queries = await loadQueries(db, prop.org_id);
    const { analysis, sub } = await runPlaybook(db, prop.org_id, { pages, queries });

    const { data: audit } = await db.from('organic_audits')
      .insert({ org_id: prop.org_id, property_id: prop.id, triggered_by: caller?.user?.id || null })
      .select().single();
    await db.from('organic_findings').insert(analysis.findings.map((x, i) => ({
      audit_id: audit.id, org_id: prop.org_id,
      category: x.category, severity: x.severity, title: x.title, summary: x.summary,
      recommendation: x.recommendation, evidence: x.evidence,
      pillar: x.pillar, value_month: x.value_month || null, fix: x.fix || null,
      sort_order: i,
    })));
    await db.from('organic_audits').update({
      status: 'complete', score: analysis.scores.composite, sub, completed_at: new Date().toISOString(),
    }).eq('id', audit.id);
    await db.from('organic_properties').update({
      status: 'ready', pages_crawled: pages.length, last_crawled_at: new Date().toISOString(),
    }).eq('id', prop.id);
    return json(200, { property_id: prop.id, audit_id: audit.id, score: analysis.scores.composite, pages: pages.length });
  } catch (err) {
    await db.from('organic_properties').update({ status: 'error', status_detail: String(err.message || err).slice(0, 300) }).eq('id', prop.id);
    return json(500, { error: String(err.message || err).slice(0, 300) });
  }
};

async function loadQueries(db, orgId) {
  const { data: gscConn } = await db.from('gsc_connections').select('id')
    .eq('org_id', orgId).eq('status', 'active').limit(1);
  if (!gscConn?.length) return [];
  const { data: q } = await db.from('gsc_query_stats')
    .select('query, page, clicks, impressions, ctr, position')
    .eq('connection_id', gscConn[0].id).limit(1500);
  return q || [];
}

function normalizeSite(input) {
  try {
    const u = new URL(input.startsWith('http') ? input : `https://${input.trim()}`);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!isPublicHost(u.hostname)) return null;
    return `${u.origin}`;
  } catch { return null; }
}
function isPublicHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h.includes('.')) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (h.includes(':')) return false;
  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}
