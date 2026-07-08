import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { supabase } from './lib/supabase';
import Auth from './pages/Auth';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import AuditReport from './pages/AuditReport';
import Playbook from './pages/Playbook';
import CommandK from './components/CommandK';
import { ToastProvider } from './components/ui';
import Alerts from './pages/Alerts';
import Discover from './pages/Discover';
import Leads from './pages/Leads';
import Inbox from './pages/Inbox';
import Sequences from './pages/Sequences';
import Settings from './pages/Settings';
import ResetPassword from './pages/ResetPassword';
import { Spinner } from './components/ui';

// Code-split: customers never download the admin console's JS.
const AdminArea = lazy(() => import('./pages/admin/AdminArea'));

export default function App() {
  const { session, loading, isAdmin, supportView, suspended, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const didInitialAdminRedirect = useRef(false);

  // Land admins on the console once per page load, even if the browser opened
  // straight to /dashboard (bookmark, cached URL, etc.) rather than "/". Only
  // fires once — clicking "Customer app →" afterward is never overridden.
  useEffect(() => {
    if (didInitialAdminRedirect.current) return;
    if (!isAdmin || supportView) return;
    didInitialAdminRedirect.current = true;
    if (location.pathname === '/' || location.pathname === '/dashboard') {
      navigate('/admin/orgs', { replace: true });
    }
  }, [isAdmin, supportView, location.pathname, navigate]);

  if (loading) return <div className="auth-wrap"><Spinner label="Waking Clarify up…" /></div>;
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Auth />} />
      </Routes>
    );
  }
  if (suspended) {
    return (
      <div className="auth-wrap">
        <div className="section" style={{ textAlign: 'center', maxWidth: 440 }}>
          <h2>This workspace is suspended</h2>
          <p className="muted" style={{ margin: '10px 0 20px' }}>
            Access has been paused by Clarify. If you think this is a mistake, reply to any email
            from us or write to support@clarifypaidsearch.com.
          </p>
          <button className="btn ghost" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }
  // The admin console lives outside the customer Shell — its own chrome, its own nav.
  if (location.pathname.startsWith('/admin')) {
    return (
      <Suspense fallback={<div className="auth-wrap"><Spinner label="Opening admin…" /></div>}>
        <AdminArea />
      </Suspense>
    );
  }
  return (
    <ToastProvider>
    <Shell>
      <Routes>
        <Route path="/" element={isAdmin && !supportView ? <Navigate to="/admin/orgs" replace /> : <Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/audit" element={<AuditReport />} />
        <Route path="/playbook" element={<Playbook />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/sequences" element={<Sequences />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Shell>
    </ToastProvider>
  );
}

function Shell({ children }) {
  const { org, profile, isAdmin, supportView, viewAsOrg, stopViewAs, signOut, effectiveOrgId } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [viewAsName, setViewAsName] = useState('');
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  const close = () => setMenuOpen(false);

  useEffect(() => {
    if (supportView && viewAsOrg) {
      supabase.from('organizations').select('name').eq('id', viewAsOrg).single()
        .then(({ data }) => setViewAsName(data?.name || viewAsOrg));
    }
  }, [supportView, viewAsOrg]);

  useEffect(() => {
    if (!effectiveOrgId) return;
    supabase.from('messages').select('id', { count: 'exact', head: true })
      .eq('org_id', effectiveOrgId).eq('direction', 'inbound').eq('is_read', false)
      .then(({ count }) => setUnread(count || 0));
  }, [effectiveOrgId, location.pathname]);

  // Subscription gate: expired trial / canceled / past_due locks everything except Settings.
  const trialEnd = org?.trial_ends_at ? new Date(org.trial_ends_at) : null;
  const trialDaysLeft = trialEnd ? Math.ceil((trialEnd - Date.now()) / 86400000) : null;
  const inGoodStanding =
    org?.subscription_status === 'active' ||
    (org?.subscription_status === 'trialing' && trialEnd && trialEnd > new Date());
  const locked = !!org && !inGoodStanding && !isAdmin;
  const showTrialBanner = org?.subscription_status === 'trialing' && trialDaysLeft != null && trialDaysLeft >= 0 && !org?.stripe_subscription_id;

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail-bar">
          <div className="brand">
            <span className="bars" aria-hidden="true"><i /><i /></span>
            <span className="word"><strong>Clarify</strong><span>SEARCH</span></span>
          </div>
          <button className="rail-toggle" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
        <div className={`rail-links${menuOpen ? ' open' : ''}`}>
          <NavLink to="/dashboard" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Today</NavLink>
          <div className="rail-label">Search</div>
          <NavLink to="/audit" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Audit</NavLink>
          <NavLink to="/alerts" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Alerts</NavLink>
          <div className="rail-label">Outreach</div>
          <NavLink to="/discover" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Discover</NavLink>
          <NavLink to="/leads" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Leads</NavLink>
          <NavLink to="/inbox" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>
            Inbox{unread > 0 && <span className="pill replied" style={{ marginLeft: 6 }}>{unread}</span>}
          </NavLink>
          <NavLink to="/sequences" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Sequences</NavLink>
          <div className="rail-label">Workspace</div>
          <NavLink to="/settings" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Settings</NavLink>
          {isAdmin && <NavLink to="/admin/orgs" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Admin console</NavLink>}
          <div className="spacer" />
          <div className="faint" style={{ padding: '0 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.email}</span>
            <span title="Command palette" style={{ flex: 'none' }}><kbd>⌘K</kbd></span>
          </div>
          <a href="#signout" onClick={(e) => { e.preventDefault(); close(); signOut(); }}>Sign out</a>
        </div>
        {menuOpen && <div className="rail-backdrop" onClick={close} />}
      </nav>
      <CommandK isAdmin={!!profile?.is_clarify_admin} />
      <main className="main">
        {supportView && (
          <div className="banner admin">
            <span>Support view: <strong>{viewAsName}</strong> — read-only</span>
            <button className="btn small ghost" onClick={() => { stopViewAs(); navigate('/admin/orgs'); }}>Exit to admin</button>
          </div>
        )}
        {showTrialBanner && !supportView && (
          <div className="banner trial">
            {trialDaysLeft === 0 ? 'Your trial ends today.' : `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left in your trial.`}{' '}
            <Link to="/settings">Pick a plan →</Link>
          </div>
        )}
        {locked && location.pathname !== '/settings' ? <Locked status={org?.subscription_status} /> : children}
      </main>
    </div>
  );
}

function Locked({ status }) {
  return (
    <div className="section" style={{ textAlign: 'center', padding: 48 }}>
      <h2>Your workspace is paused</h2>
      <p className="muted" style={{ maxWidth: 420, margin: '10px auto 20px' }}>
        {status === 'past_due'
          ? 'Your last payment didn\u2019t go through. Update billing to keep your syncs and alerts running.'
          : 'Your trial has ended. Pick a plan to keep your syncs, audits, and alerts running.'}
      </p>
      <Link to="/settings" className="btn primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
        Go to billing
      </Link>
    </div>
  );
}
