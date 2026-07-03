// POST { lead_id, body, subject?, connection_id?, channel? } — replying from the unified inbox.
const { getCaller, admin, creds, json, tierAllows } = require('./_shared/util');
const { providerFor } = require('./_shared/providers');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const orgId = caller.profile.org_id;
  const db = admin();
  const { lead_id, body, subject, connection_id, channel = 'email' } = JSON.parse(event.body || '{}');
  if (!lead_id || !body) return json(400, { error: 'Nothing to send.' });

  const [{ data: lead }, { data: org }] = await Promise.all([
    db.from('leads').select('*').eq('id', lead_id).eq('org_id', orgId).single(),
    db.from('organizations').select('*').eq('id', orgId).single(),
  ]);
  if (!lead) return json(404, { error: 'Lead not found' });

  if (channel === 'sms') {
    if (!tierAllows(org.plan_tier, 'sms')) return json(403, { error: 'SMS is a Pro feature.' });
    const { data: consent } = await db.from('consent_log').select('id').eq('lead_id', lead.id).eq('channel', 'sms').limit(1);
    if (!consent?.length) return json(403, { error: 'No SMS consent on file for this lead.' });
    const { data: conn } = await db.from('comms_connections').select('*')
      .eq('org_id', orgId).eq('kind', 'sms_twilio').eq('status', 'active').limit(1).single();
    if (!conn) return json(400, { error: 'Connect Twilio in Settings first.' });
    const r = await providerFor(conn).send({ conn, credentials: creds(conn), to: lead.phone, text: body });
    await db.from('messages').insert({
      org_id: orgId, lead_id, connection_id: conn.id, channel: 'sms', direction: 'outbound',
      status: 'sent', body_text: body, snippet: body.slice(0, 140), provider_id: r.providerId,
      occurred_at: new Date().toISOString(),
    });
    return json(200, { ok: true });
  }

  // email reply — thread onto the newest inbound if there is one
  let conn;
  if (connection_id) {
    ({ data: conn } = await db.from('comms_connections').select('*').eq('id', connection_id).eq('org_id', orgId).single());
  } else {
    const { data: lastMsg } = await db.from('messages').select('connection_id')
      .eq('lead_id', lead_id).eq('channel', 'email').not('connection_id', 'is', null)
      .order('occurred_at', { ascending: false }).limit(1);
    if (lastMsg?.[0]?.connection_id)
      ({ data: conn } = await db.from('comms_connections').select('*').eq('id', lastMsg[0].connection_id).single());
  }
  if (!conn || conn.status !== 'active') return json(400, { error: 'No active mailbox to send from.' });
  if (!lead.email) return json(400, { error: 'This lead has no email address.' });

  const { data: lastIn } = await db.from('messages').select('*')
    .eq('lead_id', lead_id).eq('direction', 'inbound').eq('channel', 'email')
    .order('occurred_at', { ascending: false }).limit(1);
  const parent = lastIn?.[0];
  const r = await providerFor(conn).send({
    conn, credentials: creds(conn), to: lead.email,
    subject: subject || (parent?.subject ? (parent.subject.startsWith('Re:') ? parent.subject : `Re: ${parent.subject}`) : 'Following up'),
    text: body,
    inReplyTo: parent?.rfc_message_id || undefined,
    references: parent ? `${parent.references_header || ''} ${parent.rfc_message_id || ''}`.trim() || undefined : undefined,
  });
  await db.from('messages').insert({
    org_id: orgId, lead_id, connection_id: conn.id, channel: 'email', direction: 'outbound',
    status: 'sent', subject: subject || parent?.subject || 'Following up',
    body_text: body, snippet: body.slice(0, 140),
    rfc_message_id: r.rfcMessageId, provider_id: r.providerId,
    in_reply_to: parent?.rfc_message_id || null,
    occurred_at: new Date().toISOString(),
  });
  return json(200, { ok: true });
};
