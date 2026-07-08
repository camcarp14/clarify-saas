const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ---------- Supabase config ----------
// The frontend mints sessions against VITE_SUPABASE_URL. Functions MUST verify
// against that same project, so we prefer the VITE_ values when present — this
// makes a client/function project mismatch structurally impossible for url+anon.
const SUPA_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPA_ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

// ---------- Supabase clients ----------
function admin() {
  return createClient(SUPA_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Verify the caller's Supabase JWT and load their profile. Returns { user, profile } or null.
// Throws loudly if the function environment is missing its Supabase config — without
// this, a scope/env mistake in Netlify masquerades as "Not signed in" for every user.
async function getCaller(event) {
  if (!SUPA_URL || !SUPA_ANON || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [!SUPA_URL && 'SUPABASE_URL/VITE_SUPABASE_URL', !SUPA_ANON && 'SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY', !process.env.SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
    throw new Error(`Function env is missing ${missing.join(', ')} — set it in Netlify (scope must include Functions), then redeploy.`);
  }
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const anon = createClient(SUPA_URL, SUPA_ANON, {
    auth: { persistSession: false },
  });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: profile } = await admin()
    .from('profiles').select('*').eq('id', data.user.id).single();
  if (!profile) return null;
  return { user: data.user, profile };
}

// ---------- Refresh-token encryption (AES-256-GCM) ----------
function key() {
  const k = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex');
  if (k.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes hex');
  return k;
}
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
function decrypt(payload) {
  const [iv, tag, ct] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// ---------- Signed OAuth state (CSRF protection) ----------
function signState(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.STATE_SIGNING_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyState(state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', process.env.STATE_SIGNING_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const obj = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (obj.exp && Date.now() > obj.exp) return null;
  return obj;
}

// ---------- Email (Resend) ----------
async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) return { skipped: true };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL || 'alerts@clarifypaidsearch.com', to, subject, html }),
  });
  return { ok: res.ok, status: res.status };
}

// ---------- HTTP helpers ----------
const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const redirect = (url) => ({ statusCode: 302, headers: { Location: url }, body: '' });

// ---------- Outreach module additions ----------
// Decrypt a comms_connections credentials blob (same AES-256-GCM as Google Ads refresh tokens).
const creds = (conn) => JSON.parse(decrypt(conn.credentials_ciphertext));

// One bundled subscription now gates BOTH modules. Tier controls ad-spend/sync cadence
// (see sync-scheduler's CADENCE_HOURS) AND outreach channel access + discovery credits.
const TIER = { starter: 0, growth: 1, pro: 2 };
const CHANNEL_MIN_TIER = { email: 'starter', linkedin: 'growth', sms: 'pro' };
const CREDITS_BY_TIER = { starter: 300, growth: 1000, pro: 3000 };
function tierAllows(planTier, channel) {
  return (TIER[planTier] ?? 0) >= (TIER[CHANNEL_MIN_TIER[channel]] ?? 0);
}
function orgInGoodStanding(org) {
  return org?.subscription_status === 'active' ||
    (org?.subscription_status === 'trialing' && new Date(org.trial_ends_at) > new Date());
}

module.exports = {
  admin, getCaller, encrypt, decrypt, signState, verifyState, sendEmail, json, redirect,
  creds, tierAllows, CREDITS_BY_TIER, orgInGoodStanding,
};
