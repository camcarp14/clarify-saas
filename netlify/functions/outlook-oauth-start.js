const { getCaller, signState, json } = require('./_shared/util');

exports.handler = async (event) => {
  const caller = await getCaller(event);
  if (!caller) return json(401, { error: 'Not signed in' });
  const state = signState({ org_id: caller.profile.org_id, uid: caller.user.id, exp: Date.now() + 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    redirect_uri: `${process.env.APP_URL}/api/outlook-oauth-callback`,
    response_type: 'code',
    response_mode: 'query',
    scope: 'offline_access Mail.Send Mail.Read User.Read',
    state,
  });
  return json(200, { url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}` });
};
