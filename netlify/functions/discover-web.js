// POST { domains: [] } -> the vertical-agnostic adapter: fetch each site, fingerprint it, extract contacts.
// Works for any lead you can name by URL — agencies, SaaS, e-com, creators — no location required.
const { getCaller, admin, json, orgInGoodStanding } = require('./_shared/util');
const { fingerprint } = require('./_shared/scrape');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { data: org } = await admin().from('organizations').select('*').eq('id', caller.profile.org_id).single();
  if (!orgInGoodStanding(org)) return json(403, { error: 'Your trial has ended — pick a plan to keep discovering.' });
  const { domains } = JSON.parse(event.body || '{}');
  const list = (domains || []).map((d) => String(d).trim()).filter(Boolean).slice(0, 15);
  if (!list.length) return json(400, { error: 'Paste at least one website.' });

  const candidates = [];
  for (const d of list) {
    const url = d.startsWith('http') ? d : `https://${d}`;
    try {
      const fp = await fingerprint(url);
      candidates.push({
        source: 'web',
        external_id: new URL(url).hostname.replace(/^www\./, ''),
        company: fp.site_title || new URL(url).hostname.replace(/^www\./, ''),
        website: url,
        email: fp.emails_found[0] || null,
        linkedin_url: fp.socials.linkedin || null,
        city: null,
        _enrichment: fp,
      });
    } catch (e) {
      candidates.push({ source: 'web', external_id: d, company: d, website: url, error: String(e.message).slice(0, 120) });
    }
  }
  return json(200, { candidates });
};
