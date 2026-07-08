// GET (Bearer) -> { effective, global, defaults } for the admin tuning UI and engines.
// POST (Bearer, Clarify admin only) { weights, notes } -> upsert the global row, bump version.
// Writes are service-role through here; RLS exposes read-only rows to the app.
const { getCaller, admin, json } = require('./_shared/util');
const { DEFAULTS, loadModelSettings } = require('./_shared/model-settings');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const db = admin();

  if (event.httpMethod === 'GET') {
    if (!caller.profile.is_clarify_admin) return json(403, { error: 'Model tuning is Clarify-admin only.' });
    const effective = await loadModelSettings(db, caller.profile.org_id);
    const { data: globals } = await db.from('model_settings').select('*').eq('scope', 'global').limit(1);
    return json(200, { effective, global: globals?.[0] || null, defaults: DEFAULTS });
  }

  if (event.httpMethod === 'POST') {
    if (!caller.profile.is_clarify_admin) return json(403, { error: 'Model tuning is Clarify-admin only.' });
    const { weights = {}, notes = {} } = JSON.parse(event.body || '{}');
    const { data: existing } = await db.from('model_settings').select('id, version').eq('scope', 'global').limit(1);
    const row = {
      scope: 'global', weights, notes,
      version: (existing?.[0]?.version || 0) + 1,
      updated_by: caller.user.id, updated_at: new Date().toISOString(),
    };
    const { data, error } = existing?.length
      ? await db.from('model_settings').update(row).eq('id', existing[0].id).select().single()
      : await db.from('model_settings').insert(row).select().single();
    if (error) return json(500, { error: error.message });
    await db.from('audit_log').insert({
      actor_id: caller.user.id, org_id: caller.profile.org_id,
      action: 'model_settings_updated', target: 'global', meta: { version: row.version },
    });
    return json(200, { saved: true, version: data.version });
  }
  return json(405, { error: 'Method not allowed' });
};
