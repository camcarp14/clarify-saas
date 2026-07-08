// POST { connection_id } (Bearer auth) -> runs the deterministic audit engine on synced data
const { getCaller, admin, json } = require('./_shared/util');
const { runAudit } = require('./_shared/audit-engine');
const { loadModelSettings } = require('./_shared/model-settings');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { connection_id } = JSON.parse(event.body || '{}');
  const db = admin();
  let connQuery = db.from('google_ads_connections').select('*').eq('id', connection_id);
  if (!caller.profile.is_clarify_admin) connQuery = connQuery.eq('org_id', caller.profile.org_id);
  const { data: conn } = await connQuery.single();
  if (!conn) return json(404, { error: 'Connection not found' });
  if (caller.profile.is_clarify_admin && conn.org_id !== caller.profile.org_id) {
    await db.from('audit_log').insert({
      actor_id: caller.user.id, org_id: conn.org_id, action: 'admin_audit_triggered',
      target: conn.customer_id, meta: { connection_id },
    });
  }
  if (!conn.last_synced_at) return json(409, { error: 'First sync still running — try again in a couple of minutes.' });

  const [{ data: snapshots }, { data: keywords }, { data: terms }, { data: acct }] = await Promise.all([
    db.from('metrics_snapshots').select('*').eq('connection_id', conn.id),
    db.from('keyword_stats').select('*').eq('connection_id', conn.id),
    db.from('search_term_stats').select('*').eq('connection_id', conn.id),
    db.from('account_snapshots').select('structure').eq('connection_id', conn.id).order('synced_at', { ascending: false }).limit(1),
  ]);

  const { data: audit } = await db.from('audits')
    .insert({ org_id: conn.org_id, connection_id: conn.id, triggered_by: caller.user.id })
    .select().single();

  try {
    const settings = await loadModelSettings(db, conn.org_id);
    const result = runAudit({
      snapshots: snapshots || [], keywords: keywords || [],
      terms: terms || [], structure: acct?.[0]?.structure || {},
    }, settings.weights);
    const rows = result.findings.map((x) => ({ ...x, audit_id: audit.id, org_id: conn.org_id }));
    await db.from('audit_findings').insert(rows);
    await db.from('audits').update({ status: 'complete', score: result.score, completed_at: new Date().toISOString() }).eq('id', audit.id);
    return json(200, { audit_id: audit.id, score: result.score, findings: rows.length });
  } catch (err) {
    await db.from('audits').update({ status: 'failed' }).eq('id', audit.id);
    return json(500, { error: String(err).slice(0, 300) });
  }
};
