// GET /api/google-oauth-start[?product=gsc]  (Bearer auth) -> { url } for Google's consent screen
// product=ads (default): Google Ads scope. product=gsc: Search Console read-only.
const { getCaller, signState, json } = require('./_shared/util');

const SCOPES = {
  ads: 'https://www.googleapis.com/auth/adwords',
  gsc: 'https://www.googleapis.com/auth/webmasters.readonly',
};

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const product = (event.queryStringParameters?.product === 'gsc') ? 'gsc' : 'ads';
  const state = signState({ org_id: caller.profile.org_id, uid: caller.user.id, product, exp: Date.now() + 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${process.env.APP_URL}/api/google-oauth-callback`,
    response_type: 'code',
    scope: SCOPES[product],
    access_type: 'offline',
    prompt: 'consent', // force refresh_token issuance
    state,
  });
  return json(200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
};
