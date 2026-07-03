// POST { query, location } -> up to 20 candidates from Google Places Text Search (New).
// Returns candidates only — saving (and spending credits) is a separate, deliberate step.
const { getCaller, admin, json, orgInGoodStanding } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { data: org } = await admin().from('organizations').select('*').eq('id', caller.profile.org_id).single();
  if (!orgInGoodStanding(org)) return json(403, { error: 'Your trial has ended — pick a plan to keep discovering.' });
  const { query, location } = JSON.parse(event.body || '{}');
  if (!query) return json(400, { error: 'What kind of business are you looking for?' });

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.addressComponents',
    },
    body: JSON.stringify({ textQuery: location ? `${query} in ${location}` : query, pageSize: 20 }),
  });
  const data = await res.json();
  if (!res.ok) return json(502, { error: `Places search failed: ${JSON.stringify(data).slice(0, 200)}` });

  const comp = (p, type) => (p.addressComponents || []).find((c) => (c.types || []).includes(type))?.longText || null;
  const candidates = (data.places || []).map((p) => ({
    source: 'places',
    external_id: p.id,
    company: p.displayName?.text || '',
    website: p.websiteUri || null,
    phone: p.nationalPhoneNumber || null,
    address: p.formattedAddress || null,
    city: comp(p, 'locality'),
    region: comp(p, 'administrative_area_level_1'),
    country: comp(p, 'country'),
    rating: p.rating ?? null,
    review_count: p.userRatingCount ?? null,
  }));
  return json(200, { candidates });
};
