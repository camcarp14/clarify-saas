// POST { message_id, action: 'sent' | 'skipped' } — closes a LinkedIn task and advances the sequence.
const { getCaller, admin, json } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { message_id, action } = JSON.parse(event.body || '{}');
  const db = admin();
  const { data: msg } = await db.from('messages').select('*')
    .eq('id', message_id).eq('org_id', caller.profile.org_id)
    .eq('channel', 'linkedin').eq('status', 'queued').single();
  if (!msg) return json(404, { error: 'Task not found (already done?)' });

  await db.from('messages').update({
    status: action === 'skipped' ? 'skipped' : 'sent',
    occurred_at: new Date().toISOString(),
  }).eq('id', msg.id);

  if (msg.enrollment_id) {
    const { data: en } = await db.from('enrollments').select('*, sequences(id)').eq('id', msg.enrollment_id).single();
    if (en && en.status === 'task_pending') {
      const { data: steps } = await db.from('sequence_steps').select('*')
        .eq('sequence_id', en.sequence_id).order('step_order');
      const liStep = en.current_step + 1;
      const next = (steps || []).find((s) => s.step_order === liStep + 1);
      await db.from('enrollments').update({
        current_step: liStep,
        status: next ? 'active' : 'completed',
        next_run_at: next ? new Date(Date.now() + (next.delay_days || 0) * 86400000).toISOString() : en.next_run_at,
      }).eq('id', en.id);
    }
  }
  return json(200, { ok: true });
};
