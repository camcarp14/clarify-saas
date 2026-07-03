// Background worker: fingerprint each lead's site, store enrichment, backfill missing emails.
const { admin } = require('./_shared/util');
const { fingerprint } = require('./_shared/scrape');

exports.handler = async (event) => {
  if ((event.headers['x-internal-secret'] || '') !== process.env.INTERNAL_SYNC_SECRET)
    return { statusCode: 401, body: 'nope' };
  const { lead_ids } = JSON.parse(event.body || '{}');
  const db = admin();
  const { data: leads } = await db.from('leads').select('*').in('id', lead_ids || []).limit(50);
  for (const lead of leads || []) {
    if (!lead.website) continue;
    try {
      const fp = await fingerprint(lead.website);
      await db.from('lead_enrichment').upsert({ lead_id: lead.id, org_id: lead.org_id, ...fp, fetched_at: new Date().toISOString() });
      const patch = { status: lead.status === 'new' ? 'enriched' : lead.status };
      if (!lead.email && fp.emails_found[0]) patch.email = fp.emails_found[0];
      if (!lead.linkedin_url && fp.socials.linkedin) patch.linkedin_url = fp.socials.linkedin;
      await db.from('leads').update(patch).eq('id', lead.id);
    } catch { /* dead site — move on */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { statusCode: 200, body: 'enriched' };
};
