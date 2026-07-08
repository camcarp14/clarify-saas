// POST { connection_id?, site_url? } (Bearer) -> pull last-28d query stats from
// Search Console into gsc_query_stats. site_url switches which GSC property syncs.
const { getCaller, admin, decrypt, json } = require('./_shared/util');
const { refreshAccessToken } = require('./_shared/google-ads');

exports.handler = async (event) => {
  const internal = (event.headers['x-internal-secret'] || '') === process.env.INTERNAL_SYNC_SECRET;
  const caller = internal ? null : await getCaller(event);
  if (!internal && !caller) return json(401, { error: 'Not signed in' });
  const { connection_id, site_url } = JSON.parse(event.body || '{}');
  const db = admin();

  let q = db.from('gsc_connections').select('*');
  if (connection_id) q = q.eq('id', connection_id);
  if (caller && !caller.profile.is_clarify_admin) q = q.eq('org_id', caller.profile.org_id);
  const { data: conns } = await q.order('created_at', { ascending: false }).limit(1);
  const conn = conns?.[0];
  if (!conn) return json(404, { error: 'No Search Console connection yet' });

  try {
    const token = await refreshAccessToken(decrypt(conn.refresh_token_ciphertext));
    let site = site_url || conn.site_url;
    if (!site) {
      const sites = await gscSites(token);
      if (!sites.length) throw new Error('This Google account has no Search Console properties.');
      site = sites[0].siteUrl;
    }
    const end = new Date(); end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 27);
    const iso = (d) => d.toISOString().slice(0, 10);
    const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: iso(start), endDate: iso(end), dimensions: ['query', 'page'], rowLimit: 1000 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Search Console returned ${res.status}`);

    const rows = (data.rows || []).map((r) => ({
      org_id: conn.org_id, connection_id: conn.id,
      query: r.keys[0], page: r.keys[1] || null,
      clicks: r.clicks || 0, impressions: r.impressions || 0,
      ctr: r.ctr || 0, position: r.position || 0, window_days: 28,
    }));
    await db.from('gsc_query_stats').delete().eq('connection_id', conn.id);
    if (rows.length) await db.from('gsc_query_stats').insert(rows);
    await db.from('gsc_connections').update({
      site_url: site, status: 'active', status_detail: null, last_synced_at: new Date().toISOString(),
    }).eq('id', conn.id);
    return json(200, { site_url: site, queries: rows.length });
  } catch (err) {
    await db.from('gsc_connections').update({ status: 'error', status_detail: String(err.message || err).slice(0, 300) }).eq('id', conn.id);
    return json(500, { error: String(err.message || err).slice(0, 300) });
  }
};

async function gscSites(token) {
  const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Could not list Search Console sites');
  return (data.siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser');
}
exports.gscSites = gscSites;
