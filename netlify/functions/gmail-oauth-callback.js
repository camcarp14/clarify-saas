const { admin, encrypt, verifyState, redirect } = require('./_shared/util');

exports.handler = async (event) => {
  const { code, state, error } = event.queryStringParameters || {};
  const app = process.env.APP_URL;
  if (error) return redirect(`${app}/settings?connect_error=${encodeURIComponent(error)}`);
  const st = verifyState(state);
  if (!st) return redirect(`${app}/settings?connect_error=bad_state`);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code, grant_type: 'authorization_code',
      redirect_uri: `${app}/api/gmail-oauth-callback`,
    }),
  });
  const tok = await res.json();
  if (!res.ok || !tok.refresh_token) return redirect(`${app}/settings?connect_error=token_exchange`);

  const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  }).then((r) => r.json()).catch(() => ({}));
  const address = (who.email || '').toLowerCase();
  if (!address) return redirect(`${app}/settings?connect_error=no_email`);

  const { error: e } = await admin().from('comms_connections').insert({
    org_id: st.org_id, kind: 'gmail', label: 'Gmail', address,
    credentials_ciphertext: encrypt(JSON.stringify({ refresh_token: tok.refresh_token })),
    connected_by: st.uid, last_synced_at: new Date().toISOString(),
  });
  if (e) return redirect(`${app}/settings?connect_error=save_failed`);
  return redirect(`${app}/settings?connected=gmail`);
};
