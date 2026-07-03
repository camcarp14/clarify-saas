// Background worker: pull inbound mail from every active mailbox, thread it to leads,
// and halt sequences the moment someone replies. This is the "stop-on-reply" guarantee.
const { admin, creds } = require('./_shared/util');
const { providerFor } = require('./_shared/providers');

exports.handler = async (event) => {
  if ((event.headers['x-internal-secret'] || '') !== process.env.INTERNAL_SYNC_SECRET)
    return { statusCode: 401, body: 'nope' };
  const db = admin();

  const { data: conns } = await db.from('comms_connections')
    .select('*, organizations(subscription_status, trial_ends_at)')
    .in('kind', ['gmail', 'outlook', 'smtp_imap']).eq('status', 'active');

  let pulled = 0;
  for (const conn of conns || []) {
    const last = conn.last_synced_at ? new Date(conn.last_synced_at) : new Date(Date.now() - 86400000);
    if (Date.now() - last.getTime() < 4 * 60 * 1000) continue;   // not due yet
    const sinceIso = new Date(last.getTime() - 10 * 60 * 1000).toISOString(); // overlap; dedupe handles repeats
    try {
      const inbound = await providerFor(conn).pullInbound({ conn, credentials: creds(conn), sinceIso });
      for (const m of inbound) {
        if (!m.fromEmail || m.fromEmail === conn.address) continue;   // skip self/sent copies
        const lead = await matchLead(db, conn.org_id, m);
        if (!lead) continue;
        const { error } = await db.from('messages').insert({
          org_id: conn.org_id, lead_id: lead.id, connection_id: conn.id,
          channel: 'email', direction: 'inbound', status: 'received',
          subject: m.subject, snippet: m.snippet, body_text: m.snippet,
          rfc_message_id: m.rfcMessageId, in_reply_to: m.inReplyTo, references_header: m.references,
          provider_id: m.providerId, occurred_at: m.occurredAt, is_read: false,
        });
        if (error) continue;   // unique (connection_id, provider_id) — already ingested
        pulled++;
        await db.from('leads').update({ status: 'replied' }).eq('id', lead.id)
          .in('status', ['new', 'enriched', 'in_sequence']);
        await db.from('enrollments').update({ status: 'replied' })
          .eq('lead_id', lead.id).in('status', ['active', 'task_pending', 'paused']);
      }
      await db.from('comms_connections').update({
        last_synced_at: new Date().toISOString(), last_error: null,
      }).eq('id', conn.id);
    } catch (err) {
      await db.from('comms_connections').update({
        status: 'error', last_error: String(err.message || err).slice(0, 300),
      }).eq('id', conn.id);
    }
  }
  return { statusCode: 200, body: `pulled ${pulled}` };
};

// Match precedence: (1) the reply chain — In-Reply-To/References pointing at a Message-ID
// we generated (strongest possible signal); (2) sender email equals a lead's email.
async function matchLead(db, orgId, m) {
  const refIds = `${m.inReplyTo || ''} ${m.references || ''}`.match(/<[^>]+>/g) || [];
  if (refIds.length) {
    const { data: parent } = await db.from('messages')
      .select('lead_id').eq('org_id', orgId).in('rfc_message_id', refIds).limit(1);
    if (parent?.length) {
      const { data: lead } = await db.from('leads').select('*').eq('id', parent[0].lead_id).single();
      if (lead) return lead;
    }
  }
  const { data: byEmail } = await db.from('leads').select('*')
    .eq('org_id', orgId).ilike('email', m.fromEmail).limit(1);
  return byEmail?.[0] || null;
}
