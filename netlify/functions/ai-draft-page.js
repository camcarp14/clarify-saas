// POST { brief } (Bearer) -> AI expansion of a Playbook content brief into draft copy.
// The brief itself is deterministic and shippable without this; drafting is sugar.
const { getCaller, json } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'AI drafting isn\u2019t configured on this deployment yet.' });
  const { brief } = JSON.parse(event.body || '{}');
  if (!brief?.outline) return json(400, { error: 'Send a Playbook brief.' });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1400,
      system: 'You draft local-business web page copy from a structured brief. Plain, specific, confident; no hype words (unlock, elevate, seamless, holistic). Write in markdown following the outline exactly: the H1, the opening answer capsule (2–3 sentences), then each H2 with 60–120 words. Never invent reviews, credentials, or prices — use [PLACEHOLDER] brackets for anything the business must supply.',
      messages: [{ role: 'user', content: `Brief JSON:\n${JSON.stringify(brief)}` }],
    }),
  });
  if (!res.ok) return json(502, { error: `AI request failed (${res.status})` });
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) return json(502, { error: 'The model returned nothing — try again.' });
  return json(200, { draft: text });
};
