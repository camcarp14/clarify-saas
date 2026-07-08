// POST { property_id } (Bearer) -> re-run the full Playbook analysis on the stored
// crawl (no re-fetch). Use after model-weight changes, a GSC sync, or paid-data
// growth — value-per-click re-derives from real spend every run.
const { getCaller, admin, json } = require('./_shared/util');
const { rowToPage, runPlaybook } = require('./_shared/playbook');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { property_id } = JSON.parse(event.body || '{}');
  const db = admin();

  let q = db.from('organic_properties').select('*').eq('id', property_id);
  if (!caller.profile.is_clarify_admin) q = q.eq('org_id', caller.profile.org_id);
  const { data: prop } = await q.single();
  if (!prop) return json(404, { error: 'Property not found' });

  const { data: pageRows } = await db.from('organic_pages').select('*').eq('property_id', prop.id);
  if (!pageRows?.length) return json(409, { error: 'No crawl stored yet — run a crawl first.' });
  const pages = pageRows.map(rowToPage);

  const { data: gscConn } = await db.from('gsc_connections').select('id')
    .eq('org_id', prop.org_id).eq('status', 'active').limit(1);
  let queries = [];
  if (gscConn?.length) {
    const { data: qs } = await db.from('gsc_query_stats')
      .select('query, page, clicks, impressions, ctr, position')
      .eq('connection_id', gscConn[0].id).limit(1500);
    queries = qs || [];
  }

  const { data: audit } = await db.from('organic_audits')
    .insert({ org_id: prop.org_id, property_id: prop.id, triggered_by: caller.user.id })
    .select().single();
  try {
    const { analysis, sub } = await runPlaybook(db, prop.org_id, { pages, queries });
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
    return json(200, { audit_id: audit.id, score: analysis.scores.composite, findings: analysis.findings.length });
  } catch (err) {
    await db.from('organic_audits').update({ status: 'failed' }).eq('id', audit.id);
    return json(500, { error: String(err).slice(0, 300) });
  }
};
