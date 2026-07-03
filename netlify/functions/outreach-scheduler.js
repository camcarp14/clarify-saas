// Every 5 min: reset expired credit periods, then kick the two background workers.
const { admin } = require('./_shared/util');

exports.handler = async () => {
  const db = admin();
  // credit period reset (30-day rolling)
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  await db.from('organizations').update({ credits_used: 0, period_started_at: new Date().toISOString() })
    .lt('period_started_at', cutoff);

  const kick = (fn) => fetch(`${process.env.APP_URL}/.netlify/functions/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SYNC_SECRET },
    body: '{}',
  }).catch(() => {});
  await Promise.all([kick('inbox-sync-background'), kick('sequence-runner-background')]);
  return { statusCode: 200, body: 'kicked' };
};
