// GET /api/google-customers?connection_id= -> [{id, name}] for the account picker
const { getCaller, admin, decrypt, json } = require('./_shared/util');
const { refreshAccessToken, listAccessibleCustomers, customerName } = require('./_shared/google-ads');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const id = event.queryStringParameters?.connection_id;
  const { data: conn } = await admin().from('google_ads_connections')
    .select('*').eq('id', id).eq('org_id', caller.profile.org_id).single();
  if (!conn) return json(404, { error: 'Connection not found' });
  const accessToken = await refreshAccessToken(decrypt(conn.refresh_token_ciphertext));
  const cids = await listAccessibleCustomers(accessToken);
  const out = [];
  for (const cid of cids.slice(0, 15)) out.push({ id: cid, name: await customerName(accessToken, cid) });
  return json(200, { customers: out });
};
