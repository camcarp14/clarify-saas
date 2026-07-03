// Google redirects here. Exchange code, encrypt refresh token, create connection.
// One accessible account -> finalize immediately; several -> pending_selection and the app asks which.
const { admin, encrypt, verifyState, redirect } = require('./_shared/util');
const { refreshAccessToken, listAccessibleCustomers, customerName } = require('./_shared/google-ads');

exports.handler = async (event) => {
  const { code, state, error } = event.queryStringParameters || {};
  const app = process.env.APP_URL;
  if (error) return redirect(`${app}/onboarding?error=${encodeURIComponent(error)}`);
  const st = verifyState(state);
  if (!st) return redirect(`${app}/onboarding?error=bad_state`);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${app}/api/google-oauth-callback`,
    }),
  });
  const tok = await res.json();
  if (!res.ok || !tok.refresh_token) return redirect(`${app}/onboarding?error=token_exchange`);

  const db = admin();
  const accessToken = await refreshAccessToken(tok.refresh_token);
  let cids = [];
  try { cids = await listAccessibleCustomers(accessToken); } catch { /* fall through to pending */ }

  const base = {
    org_id: st.org_id,
    refresh_token_ciphertext: encrypt(tok.refresh_token),
    connected_by: st.uid,
  };

  if (cids.length === 1) {
    const name = await customerName(accessToken, cids[0]);
    const { data: conn, error: e } = await db.from('google_ads_connections')
      .insert({ ...base, customer_id: cids[0], descriptive_name: name, status: 'active' })
      .select().single();
    if (e) return redirect(`${app}/onboarding?error=save_failed`);
    await seedAlertRules(db, conn);
    fireInitialSync(conn.id);
    return redirect(`${app}/dashboard?connected=1`);
  }

  const { data: conn, error: e } = await db.from('google_ads_connections')
    .insert({ ...base, status: 'pending_selection' }).select().single();
  if (e) return redirect(`${app}/onboarding?error=save_failed`);
  return redirect(`${app}/onboarding?pick=${conn.id}`);
};

async function seedAlertRules(db, conn) {
  const defaults = [
    ['budget_pace', { max_pace: 1.2 }],
    ['cpa_spike', { multiplier: 1.5, min_conversions: 5 }],
    ['conversion_tracking', { min_spend_3d: 50, min_prior_conv_28d: 10 }],
    ['pmax_brand', { impr_drop: 0.25, pmax_rise: 0.15 }],
  ].map(([rule_type, config]) => ({ org_id: conn.org_id, connection_id: conn.id, rule_type, config }));
  await db.from('alert_rules').upsert(defaults, { onConflict: 'connection_id,rule_type' });
}

function fireInitialSync(connectionId) {
  // fire-and-forget into the background function (15-min budget)
  fetch(`${process.env.APP_URL}/.netlify/functions/sync-connection-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SYNC_SECRET },
    body: JSON.stringify({ connection_id: connectionId }),
  }).catch(() => {});
}

exports.seedAlertRules = seedAlertRules;
exports.fireInitialSync = fireInitialSync;
