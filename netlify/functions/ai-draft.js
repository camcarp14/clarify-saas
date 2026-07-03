// POST { lead_id, channel, purpose, template } -> { draft }
const { getCaller, admin, json } = require('./_shared/util');
const { aiDraft } = require('./_shared/ai');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { lead_id, channel = 'email', purpose, template } = JSON.parse(event.body || '{}');
  const db = admin();
  const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).eq('org_id', caller.profile.org_id).single();
  if (!lead) return json(404, { error: 'Lead not found' });
  const { data: enrichment } = await db.from('lead_enrichment').select('*').eq('lead_id', lead_id).maybeSingle();
  const draft = await aiDraft({ lead, enrichment, channel, purpose, template });
  if (!draft) return json(503, { error: 'Drafting is unavailable right now — write it manually or try again.' });
  return json(200, { draft });
};
