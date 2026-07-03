// POST { connection_id, customer_id } -> finalize a pending connection, seed alerts, kick first sync
const { getCaller, admin, json } = require('./_shared/util');
const { seedAlertRules, fireInitialSync } = require('./google-oauth-callback');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { connection_id, customer_id, name } = JSON.parse(event.body || '{}');
  const db = admin();
  const { data: conn, error } = await db.from('google_ads_connections')
    .update({ customer_id: String(customer_id).replace(/-/g, ''), descriptive_name: name || customer_id, status: 'active' })
    .eq('id', connection_id).eq('org_id', caller.profile.org_id).eq('status', 'pending_selection')
    .select().single();
  if (error || !conn) return json(400, { error: 'Could not finalize connection' });
  await seedAlertRules(db, conn);
  fireInitialSync(conn.id);
  return json(200, { ok: true });
};
