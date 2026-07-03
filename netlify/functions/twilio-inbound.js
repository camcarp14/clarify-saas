// Twilio webhook for inbound SMS. Signature-validated per org's own auth token. STOP => suppression.
const crypto = require('crypto');
const { admin, creds } = require('./_shared/util');

exports.handler = async (event) => {
  const params = Object.fromEntries(new URLSearchParams(event.body || ''));
  const to = params.To, from = params.From, text = params.Body || '';
  if (!to || !from) return twiml();

  const db = admin();
  const { data: conns } = await db.from('comms_connections')
    .select('*').eq('kind', 'sms_twilio').eq('address', to).limit(1);
  const conn = conns?.[0];
  if (!conn) return twiml();

  // validate X-Twilio-Signature: HMAC-SHA1(auth_token, url + concat(sorted key+value))
  const url = `${process.env.APP_URL}/api/twilio-inbound`;
  const sorted = Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', creds(conn).auth_token).update(url + sorted).digest('base64');
  const given = event.headers['x-twilio-signature'] || '';
  if (given !== expected) return { statusCode: 403, body: 'bad signature' };

  const digits = from.replace(/\D/g, '').slice(-10);
  const { data: leads } = await db.from('leads').select('*')
    .eq('org_id', conn.org_id).not('phone', 'is', null).limit(2000);
  const lead = (leads || []).find((l) => (l.phone || '').replace(/\D/g, '').slice(-10) === digits);
  if (!lead) return twiml();

  await db.from('messages').insert({
    org_id: conn.org_id, lead_id: lead.id, connection_id: conn.id,
    channel: 'sms', direction: 'inbound', status: 'received',
    body_text: text, snippet: text.slice(0, 140),
    provider_id: params.MessageSid, occurred_at: new Date().toISOString(), is_read: false,
  });

  if (/^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i.test(text)) {
    await db.from('suppressions').upsert(
      { org_id: conn.org_id, value: digits, reason: 'unsubscribed' },
      { onConflict: 'org_id,value', ignoreDuplicates: true });
    await db.from('leads').update({ status: 'unsubscribed' }).eq('id', lead.id);
    await db.from('enrollments').update({ status: 'stopped' })
      .eq('lead_id', lead.id).in('status', ['active', 'task_pending', 'paused']);
  } else {
    await db.from('leads').update({ status: 'replied' }).eq('id', lead.id)
      .in('status', ['new', 'enriched', 'in_sequence']);
    await db.from('enrollments').update({ status: 'replied' })
      .eq('lead_id', lead.id).in('status', ['active', 'task_pending', 'paused']);
  }
  return twiml();
};

const twiml = () => ({
  statusCode: 200, headers: { 'Content-Type': 'text/xml' },
  body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
});
