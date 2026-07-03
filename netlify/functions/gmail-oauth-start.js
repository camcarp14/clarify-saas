const { getCaller, signState, json } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const state = signState({ org_id: caller.profile.org_id, uid: caller.user.id, exp: Date.now() + 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${process.env.APP_URL}/api/gmail-oauth-callback`,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return json(200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
};
