// Scheduled every 30 min (netlify.toml). Finds connections due by tier cadence and fans out
// one background invocation per connection — one slow account never blocks the rest.
const { admin } = require('./_shared/util');

const CADENCE_HOURS = { starter: 22, growth: 22, pro: 0.9 }; // starter/growth nightly-daily, pro hourly

exports.handler = async () => {
  const db = admin();
  const { data: conns } = await db.from('google_ads_connections')
    .select('id, last_synced_at, org_id, organizations(plan_tier, subscription_status, trial_ends_at)')
    .eq('status', 'active');
  const now = Date.now();
  let fired = 0;
  for (const c of conns || []) {
    const org = c.organizations;
    const paying = ['active', 'trialing'].includes(org?.subscription_status) ||
      (org?.trial_ends_at && new Date(org.trial_ends_at) > new Date());
    if (!paying) continue;
    const hours = CADENCE_HOURS[org?.plan_tier] ?? 22;
    const due = !c.last_synced_at || now - new Date(c.last_synced_at).getTime() > hours * 3600 * 1000;
    if (!due) continue;
    fired++;
    fetch(`${process.env.APP_URL}/.netlify/functions/sync-connection-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SYNC_SECRET },
      body: JSON.stringify({ connection_id: c.id }),
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400)); // stagger, be polite to the shared dev-token quota
  }
  return { statusCode: 200, body: `fired ${fired}` };
};
