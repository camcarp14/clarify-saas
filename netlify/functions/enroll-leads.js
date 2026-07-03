// POST { sequence_id, lead_ids, connection_id } — validation happens here AND at send time.
const { getCaller, admin, json, tierAllows } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const orgId = caller.profile.org_id;
  const db = admin();
  const { sequence_id, lead_ids, connection_id } = JSON.parse(event.body || '{}');
  if (!sequence_id || !lead_ids?.length) return json(400, { error: 'Pick a sequence and at least one lead.' });

  const [{ data: org }, { data: seq }, { data: steps }] = await Promise.all([
    db.from('organizations').select('*').eq('id', orgId).single(),
    db.from('sequences').select('*').eq('id', sequence_id).eq('org_id', orgId).single(),
    db.from('sequence_steps').select('*').eq('sequence_id', sequence_id).order('step_order'),
  ]);
  if (!seq) return json(404, { error: 'Sequence not found' });
  if (!steps?.length) return json(400, { error: 'This sequence has no steps yet.' });

  for (const s of steps) if (!tierAllows(org.plan_tier, s.channel))
    return json(403, { error: `This sequence uses ${s.channel}, which needs a higher plan.` });

  const hasEmail = steps.some((s) => s.channel === 'email');
  if (hasEmail) {
    if (!org.mailing_address) return json(400, { error: 'Add your mailing address in Settings first — every email footer must carry it (CAN-SPAM).' });
    const { data: conn } = await db.from('comms_connections').select('id, kind, status')
      .eq('id', connection_id).eq('org_id', orgId).single();
    if (!conn || conn.status !== 'active' || conn.kind === 'sms_twilio')
      return json(400, { error: 'Pick an active mailbox to send from.' });
  }

  const first = steps[0];
  let enrolled = 0, skipped = 0;
  for (const leadId of lead_ids.slice(0, 500)) {
    const { error } = await db.from('enrollments').insert({
      org_id: orgId, sequence_id, lead_id: leadId,
      connection_id: hasEmail ? connection_id : null,
      next_run_at: new Date(Date.now() + (first.delay_days || 0) * 86400000).toISOString(),
      enrolled_by: caller.user.id,
    });
    if (error) skipped++; else enrolled++;
  }
  return json(200, { enrolled, skipped });
};
