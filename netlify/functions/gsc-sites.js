// GET (Bearer) -> Search Console properties available on the connected Google account,
// so the UI can offer a switcher when the auto-picked site was wrong.
const { getCaller, admin, decrypt, json } = require('./_shared/util');
const { refreshAccessToken } = require('./_shared/google-ads');
const { gscSites } = require('./gsc-sync');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const db = admin();
  const { data: conns } = await db.from('gsc_connections').select('*')
    .eq('org_id', caller.profile.org_id).neq('status', 'revoked')
    .order('created_at', { ascending: false }).limit(1);
  if (!conns?.length) return json(404, { error: 'No Search Console connection yet' });
  try {
    const token = await refreshAccessToken(decrypt(conns[0].refresh_token_ciphertext));
    const sites = await gscSites(token);
    return json(200, { connection_id: conns[0].id, current: conns[0].site_url, sites: sites.map((s) => s.siteUrl) });
  } catch (err) {
    return json(500, { error: String(err.message || err).slice(0, 300) });
  }
};
