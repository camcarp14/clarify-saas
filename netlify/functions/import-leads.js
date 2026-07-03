// POST { rows: [] } — CSV import (parsed client-side). Free, deduped, attested.
const { getCaller, admin, json } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { rows, attest_consent } = JSON.parse(event.body || '{}');
  if (!rows?.length) return json(400, { error: 'No rows to import.' });
  const db = admin();
  let saved = 0, skipped = 0;
  for (const r of rows.slice(0, 2000)) {
    const { data: lead, error } = await db.from('leads').insert({
      org_id: caller.profile.org_id, source: 'csv',
      name: r.name || null, company: r.company || null, title: r.title || null,
      email: r.email ? String(r.email).toLowerCase() : null,
      phone: r.phone || null, website: r.website || null, linkedin_url: r.linkedin_url || null,
      city: r.city || null, region: r.region || null, country: r.country || null,
      created_by: caller.user.id,
    }).select('id').single();
    if (error) { skipped++; continue; }
    saved++;
    if (attest_consent && r.email) {
      await db.from('consent_log').insert({
        org_id: caller.profile.org_id, lead_id: lead.id, channel: 'email',
        method: 'imported_with_attestation', captured_by: caller.user.id,
        evidence: { note: 'Importer attested this list was collected with consent.' },
      });
    }
  }
  await db.from('discovery_jobs').insert({
    org_id: caller.profile.org_id, adapter: 'csv', criteria: { rows: rows.length },
    results_count: saved, credits_spent: 0, created_by: caller.user.id,
  });
  return json(200, { saved, skipped });
};
