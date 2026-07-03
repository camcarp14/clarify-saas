// Background worker: advance every due enrollment one step. Invoked by the scheduler.
// The guardrails live HERE, at send time — not in the UI — so nothing bypasses them.
const { admin, creds, tierAllows, orgInGoodStanding } = require('./_shared/util');
const { providerFor } = require('./_shared/providers');
const { render, emailFooter } = require('./_shared/render');
const { aiDraft } = require('./_shared/ai');

exports.handler = async (event) => {
  if ((event.headers['x-internal-secret'] || '') !== process.env.INTERNAL_SYNC_SECRET)
    return { statusCode: 401, body: 'nope' };
  const db = admin();

  const { data: due } = await db.from('enrollments')
    .select('*, sequences(*), leads(*), comms_connections(*), organizations(*)')
    .eq('status', 'active').lte('next_run_at', new Date().toISOString())
    .order('next_run_at').limit(40);

  let processed = 0;
  for (const en of due || []) {
    try { await processOne(db, en); processed++; }
    catch (err) {
      const attempts = (en.attempts || 0) + 1;
      await db.from('enrollments').update({
        attempts,
        status: attempts >= 3 ? 'failed' : 'active',
        next_run_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        last_error: String(err.message || err).slice(0, 300),
      }).eq('id', en.id);
    }
  }
  return { statusCode: 200, body: `processed ${processed}` };
};

async function processOne(db, en) {
  const org = en.organizations, seq = en.sequences, lead = en.leads, conn = en.comms_connections;
  const halt = (status, why) =>
    db.from('enrollments').update({ status, last_error: why || null }).eq('id', en.id);

  if (!orgInGoodStanding(org)) return halt('paused', 'Subscription not in good standing');
  if (!seq || seq.status !== 'active') return halt('paused', 'Sequence paused');
  if (['replied', 'won', 'lost', 'unsubscribed', 'bounced'].includes(lead.status))
    return halt(lead.status === 'replied' ? 'replied' : 'stopped', `Lead is ${lead.status}`);

  const { data: steps } = await db.from('sequence_steps').select('*')
    .eq('sequence_id', seq.id).order('step_order');
  const step = (steps || []).find((s) => s.step_order === en.current_step + 1);
  if (!step) return halt('completed');

  if (!tierAllows(org.plan_tier, step.channel))
    return halt('paused', `${step.channel} requires a higher plan`);

  // suppression check — the unsubscribe list wins over everything
  const values = [lead.email?.toLowerCase(), (lead.phone || '').replace(/\D/g, '').slice(-10)].filter(Boolean);
  if (values.length) {
    const { data: sup } = await db.from('suppressions').select('id').eq('org_id', org.id).in('value', values).limit(1);
    if (sup?.length) return halt('stopped', 'Contact is on your suppression list');
  }

  const { data: enrichment } = await db.from('lead_enrichment').select('*').eq('lead_id', lead.id).maybeSingle();

  // render: AI personalization with template fallback — the template is the floor, never the ceiling
  let body = render(step.body, lead, enrichment);
  if (step.use_ai) {
    const ai = await aiDraft({ lead, enrichment, channel: step.channel, template: body });
    if (ai) body = ai;
  }

  if (step.channel === 'linkedin') {
    // Assisted, never automated: draft it, queue it, a human clicks send on LinkedIn itself.
    await db.from('messages').insert({
      org_id: org.id, lead_id: lead.id, enrollment_id: en.id,
      channel: 'linkedin', direction: 'outbound', status: 'queued',
      body_text: body, snippet: body.slice(0, 140), occurred_at: new Date().toISOString(),
    });
    return db.from('enrollments').update({ status: 'task_pending', attempts: 0 }).eq('id', en.id);
  }

  if (step.channel === 'sms') {
    if (!lead.phone) return halt('failed', 'Lead has no phone number');
    const { data: consent } = await db.from('consent_log').select('id')
      .eq('lead_id', lead.id).eq('channel', 'sms').limit(1);
    if (!consent?.length)
      return halt('paused', 'No SMS consent on file for this lead — record it on the lead before texting');
    const { data: smsConn } = await db.from('comms_connections').select('*')
      .eq('org_id', org.id).eq('kind', 'sms_twilio').eq('status', 'active').limit(1).single();
    if (!smsConn) return halt('paused', 'Connect Twilio in Settings to send SMS');
    const r = await providerFor(smsConn).send({ conn: smsConn, credentials: creds(smsConn), to: lead.phone, text: body });
    await logAndAdvance(db, en, steps, step, {
      connection_id: smsConn.id, channel: 'sms', body, providerId: r.providerId, rfcMessageId: null,
    });
    return;
  }

  // email
  if (!lead.email) return halt('failed', 'Lead has no email address');
  if (!conn || conn.status !== 'active' || conn.kind === 'sms_twilio')
    return halt('paused', 'Pick an active mailbox for this sequence');
  if (!org.mailing_address)
    return halt('paused', 'Add your mailing address in Settings — CAN-SPAM requires it in every email');

  // daily cap + warmup ramp for young mailboxes
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count: sentToday } = await db.from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', conn.id).eq('direction', 'outbound')
    .gte('occurred_at', since.toISOString());
  const ageDays = Math.floor((Date.now() - new Date(conn.created_at)) / 86400000);
  const cap = ageDays < 14 ? Math.min(conn.daily_send_cap, 10 + 3 * ageDays) : conn.daily_send_cap;
  if ((sentToday || 0) >= cap) {
    return db.from('enrollments').update({
      next_run_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
      last_error: `Daily cap (${cap}) reached for ${conn.address} — resuming later`,
    }).eq('id', en.id);
  }

  const subject = render(step.subject || '', lead, enrichment) || 'Quick question';
  const fullBody = body + emailFooter(org, lead);
  const r = await providerFor(conn).send({ conn, credentials: creds(conn), to: lead.email, subject, text: fullBody });
  await logAndAdvance(db, en, steps, step, {
    connection_id: conn.id, channel: 'email', subject, body: fullBody,
    providerId: r.providerId, rfcMessageId: r.rfcMessageId,
  });
}

async function logAndAdvance(db, en, steps, step, m) {
  await db.from('messages').insert({
    org_id: en.org_id, lead_id: en.lead_id, connection_id: m.connection_id, enrollment_id: en.id,
    channel: m.channel, direction: 'outbound', status: 'sent',
    subject: m.subject || null, body_text: m.body, snippet: m.body.slice(0, 140),
    rfc_message_id: m.rfcMessageId, provider_id: m.providerId,
    occurred_at: new Date().toISOString(),
  });
  const next = steps.find((s) => s.step_order === step.step_order + 1);
  await db.from('enrollments').update({
    current_step: step.step_order,
    attempts: 0, last_error: null,
    status: next ? 'active' : 'completed',
    next_run_at: next
      ? new Date(Date.now() + (next.delay_days || 0) * 86400000).toISOString()
      : en.next_run_at,
  }).eq('id', en.id);
  await db.from('leads').update({ status: 'in_sequence' })
    .eq('id', en.lead_id).in('status', ['new', 'enriched']);
}
