// GET -> the health signals only the service role can see (stripe_events has no
// client-readable RLS policy, by design). Everything else on the Health page reads
// client-side through the existing admin SELECT bypasses.
const { getCaller, admin, json } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  if (!caller.profile.is_clarify_admin) return json(403, { error: 'Admins only' });
  const db = admin();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const [{ data: recent }, { count: count24h }] = await Promise.all([
    db.from('stripe_events').select('*').order('processed_at', { ascending: false }).limit(10),
    db.from('stripe_events').select('id', { count: 'exact', head: true }).gte('processed_at', dayAgo),
  ]);
  return json(200, { stripeEvents: recent || [], stripeEvents24h: count24h || 0 });
};
