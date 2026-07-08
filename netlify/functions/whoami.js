// GET /api/whoami (with Authorization header) — walks the exact same steps as
// getCaller and reports where the chain breaks. Safe: returns step results and
// token *metadata* (issuer/expiry/subject), never the token or any key.
const { createClient } = require('@supabase/supabase-js');

const SUPA_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPA_ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

exports.handler = async (event) => {
  const out = { effective_url: SUPA_URL };
  const auth = event.headers.authorization || event.headers.Authorization || '';
  out.step1_auth_header_present = auth.startsWith('Bearer ');
  const token = out.step1_auth_header_present ? auth.slice(7) : null;

  if (!token) {
    return json(200, {
      ...out,
      how_to_run: "Open the app while signed in, press F12 → Console, paste: fetch('/api/whoami',{headers:{Authorization:'Bearer '+(o=>o.access_token||o.currentSession?.access_token)(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.includes('auth-token')))))}}).then(r=>r.json()).then(console.log)",
    });
  }

  // decode (not verify) the JWT payload — issuer tells us which project minted it
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    out.token_issuer = payload.iss || null;
    out.token_subject = payload.sub || null;
    out.token_role = payload.role || null;
    out.token_expired = payload.exp ? payload.exp * 1000 < Date.now() : null;
    out.issuer_matches_effective_url = payload.iss ? String(payload.iss).startsWith(String(SUPA_URL)) : null;
  } catch { out.token_decode = 'failed — not a JWT?'; }

  // step 2: verify the token the way getCaller does
  const anon = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.getUser(token);
  out.step2_getUser_ok = !error && !!data?.user;
  if (error) out.step2_getUser_error = error.message;
  if (data?.user) { out.user_id = data.user.id; out.user_email = data.user.email; }

  // step 3: load the profile the way getCaller does
  if (data?.user) {
    const admin = createClient(SUPA_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: profile, error: pErr } = await admin.from('profiles').select('id, org_id, email, is_clarify_admin').eq('id', data.user.id).single();
    out.step3_profile_found = !!profile;
    if (pErr) out.step3_profile_error = pErr.message;
    if (profile) out.profile = { org_id: profile.org_id, email: profile.email, is_clarify_admin: profile.is_clarify_admin };
    if (!profile && data.user.email) {
      const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('email', data.user.email);
      out.profiles_with_same_email = count ?? 0;
    }
  }

  out.conclusion = !out.step1_auth_header_present ? 'no Authorization header reached the function'
    : !out.step2_getUser_ok ? 'token rejected by Supabase auth — see step2_getUser_error and issuer fields'
    : !out.step3_profile_found ? 'auth user has NO row in profiles — that is the 401'
    : 'everything passes — getCaller should succeed';
  return json(200, out);
};

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) });
