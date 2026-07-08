// GET /api/env-check — deployment self-diagnosis. Safe to expose: returns only
// booleans, hostnames, and error strings — never key material. Delete after use
// if you like, but it leaks nothing the client bundle doesn't already contain.
const { createClient } = require('@supabase/supabase-js');

const host = (u) => { try { return new URL(u).host; } catch { return null; } };
const SUPA_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPA_ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

exports.handler = async () => {
  const out = {
    context: process.env.CONTEXT || null,
    effective_url_host: host(SUPA_URL),
    supabase_url_present: !!process.env.SUPABASE_URL,
    supabase_url_host: host(process.env.SUPABASE_URL),
    vite_supabase_url_host: host(process.env.VITE_SUPABASE_URL),
    urls_match: null,
    anon_key_present: !!process.env.SUPABASE_ANON_KEY,
    anon_matches_vite_anon: null,
    anon_key_works: null,
    service_key_present: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    service_key_works: null,
    internal_sync_secret_present: !!process.env.INTERNAL_SYNC_SECRET,
    anthropic_key_present: !!process.env.ANTHROPIC_API_KEY,
    google_client_present: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    stripe_present: !!process.env.STRIPE_SECRET_KEY,
  };

  if (out.supabase_url_host && out.vite_supabase_url_host) {
    out.urls_match = out.supabase_url_host === out.vite_supabase_url_host;
  }
  if (process.env.SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY) {
    out.anon_matches_vite_anon = process.env.SUPABASE_ANON_KEY.trim() === process.env.VITE_SUPABASE_ANON_KEY.trim();
  }

  // Does the anon key actually work against this URL? A garbage token should come
  // back "invalid JWT" (key+url good); network/apikey errors mean they're not.
  if (SUPA_URL && SUPA_ANON) {
    try {
      const anon = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
      const { error } = await anon.auth.getUser('not-a-real-token');
      out.anon_key_works = error ? (/jwt|token|invalid|malformed/i.test(error.message) ? true : `error: ${error.message}`) : true;
    } catch (e) { out.anon_key_works = `threw: ${String(e.message || e).slice(0, 140)}`; }
  }

  // Service key: one trivial RLS-bypassing read.
  if (SUPA_URL && out.service_key_present) {
    try {
      const admin = createClient(SUPA_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const { error } = await admin.from('profiles').select('id').limit(1);
      out.service_key_works = error ? `error: ${error.message}` : true;
    } catch (e) { out.service_key_works = `threw: ${String(e.message || e).slice(0, 140)}`; }
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out, null, 2) };
};
