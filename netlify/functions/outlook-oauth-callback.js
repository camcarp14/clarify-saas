const { admin, encrypt, verifyState, redirect } = require('./_shared/util');

exports.handler = async (event) => {
  const { code, state, error } = event.queryStringParameters || {};
  const app = process.env.APP_URL;
  if (error) return redirect(`${app}/settings?connect_error=${encodeURIComponent(error)}`);
  const st = verifyState(state);
  if (!st) return redirect(`${app}/settings?connect_error=bad_state`);

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      code, grant_type: 'authorization_code',
      redirect_uri: `${app}/api/outlook-oauth-callback`,
      scope: 'offline_access Mail.Send Mail.Read User.Read',
    }),
  });
  const tok = await res.json();
  if (!res.ok || !tok.refresh_token) return redirect(`${app}/settings?connect_error=token_exchange`);

  const me = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  }).then((r) => r.json()).catch(() => ({}));
  const address = (me.mail || me.userPrincipalName || '').toLowerCase();
  if (!address) return redirect(`${app}/settings?connect_error=no_email`);

  const { error: e } = await admin().from('comms_connections').insert({
    org_id: st.org_id, kind: 'outlook', label: 'Outlook', address,
    credentials_ciphertext: encrypt(JSON.stringify({ refresh_token: tok.refresh_token })),
    connected_by: st.uid, last_synced_at: new Date().toISOString(),
  });
  if (e) return redirect(`${app}/settings?connect_error=save_failed`);
  return redirect(`${app}/settings?connected=outlook`);
};
