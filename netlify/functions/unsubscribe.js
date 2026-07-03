// GET ?t=<signed token> — one click, no login, permanent. The link every email footer carries.
const { admin } = require('./_shared/util');
const { verifyUnsubToken } = require('./_shared/render');

exports.handler = async (event) => {
  const t = verifyUnsubToken(event.queryStringParameters?.t);
  const html = (msg) => ({
    statusCode: 200, headers: { 'Content-Type': 'text/html' },
    body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;display:grid;place-items:center;min-height:90vh;background:#FBFAF7;color:#212430"><div style="text-align:center;max-width:420px;padding:24px"><h2>${msg}</h2></div>`,
  });
  if (!t) return html('That unsubscribe link isn\u2019t valid.');
  const db = admin();
  const { data: lead } = await db.from('leads').select('*').eq('id', t.leadId).eq('org_id', t.orgId).single();
  if (!lead) return html('You\u2019re unsubscribed.');
  if (lead.email) await db.from('suppressions').upsert(
    { org_id: t.orgId, value: lead.email.toLowerCase(), reason: 'unsubscribed' },
    { onConflict: 'org_id,value', ignoreDuplicates: true });
  await db.from('leads').update({ status: 'unsubscribed' }).eq('id', lead.id);
  await db.from('enrollments').update({ status: 'stopped' })
    .eq('lead_id', lead.id).in('status', ['active', 'task_pending', 'paused']);
  return html('You\u2019re unsubscribed. You won\u2019t hear from this sender again.');
};
