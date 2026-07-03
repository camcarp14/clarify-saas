// Template rendering: merge fields + the CAN-SPAM footer no customer can forget to include.
const crypto = require('crypto');

function mergeFields(lead, enrichment) {
  const firstName = (lead.name || '').trim().split(/\s+/)[0] || '';
  return {
    first_name: firstName,
    name: lead.name || '',
    company: lead.company || '',
    website: (lead.website || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    city: lead.city || '',
    title: lead.title || '',
    signal: enrichment?.signals?.headline || enrichment?.site_title || '',
  };
}

function render(template, lead, enrichment) {
  const fields = mergeFields(lead, enrichment);
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => fields[k] ?? '');
}

function unsubToken(orgId, leadId) {
  const body = Buffer.from(JSON.stringify({ o: orgId, l: leadId })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.STATE_SIGNING_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyUnsubToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', process.env.STATE_SIGNING_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const { o, l } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  return { orgId: o, leadId: l };
}

// CAN-SPAM: identify the sender, include a physical address, honor a working opt-out.
function emailFooter(org, lead) {
  const link = `${process.env.APP_URL}/api/unsubscribe?t=${unsubToken(org.id, lead.id)}`;
  return `\n\n--\n${org.name}\n${org.mailing_address}\nDon't want to hear from us? Unsubscribe: ${link}`;
}

module.exports = { render, mergeFields, emailFooter, unsubToken, verifyUnsubToken };
