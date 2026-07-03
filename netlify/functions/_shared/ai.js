// AI drafting — phrases outreach from real enrichment signals. Token-thrifted, always falls back to template.
async function aiDraft({ lead, enrichment, channel, purpose, template }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const signals = {
    company: lead.company, name: lead.name, city: lead.city, website: lead.website,
    site_title: enrichment?.site_title, site_description: enrichment?.site_description,
    signals: enrichment?.signals, tech: enrichment?.tech,
    excerpt: (enrichment?.content_excerpt || '').slice(0, 900),
  };
  const limits = channel === 'sms' ? 'Max 300 characters. No links unless one was provided.'
    : channel === 'linkedin' ? 'Max 280 characters — a LinkedIn connection note. Warm, specific, no pitch-slap.'
    : '80-130 words. Plain text. One specific observation about their business, one clear reason you\'re reaching out, one low-friction ask. No subject line, no sign-off, no placeholders.';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 500,
      system: `You write cold outreach for small businesses. Specific beats clever. Never invent facts not present in the signals. Never use placeholder brackets. ${limits}`,
      messages: [{
        role: 'user',
        content: `Write the ${channel} message. Purpose: ${purpose || 'open a conversation about working together'}.\nIf a base template is given, keep its intent but personalize it.\nBase template (may be empty): ${template || '(none)'}\nLead signals JSON: ${JSON.stringify(signals)}`,
      }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return text || null;
}
module.exports = { aiDraft };
