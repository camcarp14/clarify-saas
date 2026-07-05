import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ownOrg, setOwnOrg] = useState(null);
  const [viewOrgRow, setViewOrgRow] = useState(null); // the impersonated tenant's org row
  const [loading, setLoading] = useState(true);
  const [viewAsOrg, setViewAsOrg] = useState(() => localStorage.getItem('clarify_view_as') || null);

  const loadProfile = useCallback(async (userId) => {
    const { data: p } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile(p || null);
    if (p) {
      const { data: o } = await supabase.from('organizations').select('*').eq('id', p.org_id).single();
      setOwnOrg(o || null);
      supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId)
        .then(() => {});
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadProfile(data.session.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadProfile(s.user.id);
      else { setProfile(null); setOwnOrg(null); setViewOrgRow(null); }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const isAdmin = !!profile?.is_clarify_admin;
  const effectiveOrgId = isAdmin && viewAsOrg ? viewAsOrg : profile?.org_id || null;
  const supportView = isAdmin && !!viewAsOrg; // read-only support mode

  // The connection that makes support view honest: while impersonating, `org`
  // IS the tenant's org row — so Settings, trial state, credits, and every page
  // reading org.* reflects the customer being viewed, not the admin's own org.
  useEffect(() => {
    if (!isAdmin || !viewAsOrg) { setViewOrgRow(null); return; }
    supabase.from('organizations').select('*').eq('id', viewAsOrg).single()
      .then(({ data }) => setViewOrgRow(data || null));
  }, [isAdmin, viewAsOrg]);

  const org = supportView && viewOrgRow ? viewOrgRow : ownOrg;
  const suspended = !!ownOrg?.suspended_at && !isAdmin;

  const startViewAs = async (orgId, orgName) => {
    if (!isAdmin) return;
    localStorage.setItem('clarify_view_as', orgId);
    setViewAsOrg(orgId);
    await supabase.from('audit_log').insert({
      actor_id: profile.id, org_id: orgId, action: 'admin_view_as_tenant', target: orgName || orgId,
    });
  };
  const stopViewAs = () => { localStorage.removeItem('clarify_view_as'); setViewAsOrg(null); setViewOrgRow(null); };
  const signOut = async () => { stopViewAs(); await supabase.auth.signOut(); };

  return (
    <Ctx.Provider value={{
      session, profile, org, loading, isAdmin, effectiveOrgId, supportView, suspended,
      startViewAs, stopViewAs, signOut,
      refreshOrg: () => {
        if (profile) loadProfile(profile.id);
        if (isAdmin && viewAsOrg) supabase.from('organizations').select('*').eq('id', viewAsOrg).single()
          .then(({ data }) => setViewOrgRow(data || null));
      },
    }}>
      {children}
    </Ctx.Provider>
  );
}
