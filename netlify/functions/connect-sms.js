// POST { account_sid, auth_token, from_number } — Pro tier. Verifies the Twilio creds before saving.
const { getCaller, admin, encrypt, json, tierAllows } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const { data: org } = await admin().from('organizations').select('*').eq('id', caller.profile.org_id).single();
  if (!tierAllows(org.plan_tier, 'sms')) return json(403, { error: 'SMS is a Pro feature.' });
  const { account_sid, auth_token, from_number } = JSON.parse(event.body || '{}');
  if (!account_sid || !auth_token || !from_number) return json(400, { error: 'All three Twilio fields are required.' });

  const auth = Buffer.from(`${account_sid}:${auth_token}`).toString('base64');
  const check = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account_sid}.json`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!check.ok) return json(400, { error: 'Twilio rejected those credentials.' });

  const { error } = await admin().from('comms_connections').insert({
    org_id: caller.profile.org_id, kind: 'sms_twilio', label: 'SMS (Twilio)',
    address: from_number,
    credentials_ciphertext: encrypt(JSON.stringify({ account_sid, auth_token })),
    connected_by: caller.user.id,
  });
  if (error) return json(400, { error: 'Could not save connection.' });
  return json(200, { ok: true, note: 'Reminder: your Twilio number must have completed A2P 10DLC registration or US carriers will block its messages.' });
};
