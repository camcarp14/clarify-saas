// POST { candidates: [], adapter, criteria } -> dedupe, insert, spend credits, log the discovery job.
const { getCaller, admin, json } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const orgId = caller.profile.org_id;
  const db = admin();
  const { candidates, adapter, criteria } = JSON.parse(event.body || '{}');
  if (!candidates?.length) return json(400, { error: 'Nothing selected.' });

  const { data: org } = await db.from('organizations').select('*').eq('id', orgId).single();
  const remaining = org.monthly_credits - org.credits_used;
  const chargeable = adapter === 'csv' ? 0 : candidates.length;   // imports are free; discovery costs credits
  if (chargeable > remaining) return json(402, { error: `That's ${chargeable} credits but you have ${remaining} left this period.` });

  let saved = 0, skipped = 0;
  const enrichIds = [];
  for (const c of candidates) {
    const row = {
      org_id: orgId,
      source: c.source || adapter, external_id: c.external_id || null,
      name: c.name || null, company: c.company || null, title: c.title || null,
      email: c.email ? String(c.email).toLowerCase() : null,
      phone: c.phone || null, website: c.website || null, linkedin_url: c.linkedin_url || null,
      address: c.address || null, city: c.city || null, region: c.region || null, country: c.country || null,
      rating: c.rating ?? null, review_count: c.review_count ?? null,
      created_by: caller.user.id,
    };
    const { data: lead, error } = await db.from('leads').insert(row).select('id').single();
    if (error) { skipped++; continue; }   // unique index = already have this one
    saved++;
    if (c._enrichment) {
      await db.from('lead_enrichment').upsert({ lead_id: lead.id, org_id: orgId, ...c._enrichment });
      await db.from('leads').update({ status: 'enriched' }).eq('id', lead.id);
    } else if (row.website) enrichIds.push(lead.id);
  }

  const spent = adapter === 'csv' ? 0 : saved;
  if (spent) await db.from('organizations').update({ credits_used: org.credits_used + spent }).eq('id', orgId);
  await db.from('discovery_jobs').insert({
    org_id: orgId, adapter: adapter || 'manual', criteria: criteria || {},
    results_count: saved, credits_spent: spent, created_by: caller.user.id,
  });

  if (enrichIds.length) {
    fetch(`${process.env.APP_URL}/.netlify/functions/enrich-leads-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SYNC_SECRET },
      body: JSON.stringify({ lead_ids: enrichIds }),
    }).catch(() => {});
  }
  return json(200, { saved, skipped, credits_spent: spent, credits_left: remaining - spent });
};
