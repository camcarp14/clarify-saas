import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AdminOrgs from './AdminOrgs';
import AdminOrgDetail from './AdminOrgDetail';
import AdminHealth from './AdminHealth';
import AdminBilling from './AdminBilling';
import AdminAudit from './AdminAudit';
import AdminModel from './AdminModel';

// The internal console shell — same layout primitives as the customer app, its own
// nav, and an unmissable ADMIN strip so a screen-share never confuses the two.
export default function AdminArea() {
  const { isAdmin, profile, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  const close = () => setMenuOpen(false);
  return (
    <div>
      <div className="admin-top">CLARIFY ADMIN — internal console. Every action here is logged.</div>
      <div className="shell">
        <nav className="rail">
          <div className="rail-bar">
            <div className="brand">
              <span className="bars" aria-hidden="true"><i /><i /></span>
              <span className="word"><strong>Clarify</strong><span>ADMIN</span></span>
            </div>
            <button className="rail-toggle" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
          <div className={`rail-links${menuOpen ? ' open' : ''}`}>
            <NavLink to="/admin/orgs" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Organizations</NavLink>
            <NavLink to="/admin/health" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>System health</NavLink>
            <NavLink to="/admin/billing" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Billing</NavLink>
            <NavLink to="/admin/audit" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Audit trail</NavLink>
            <NavLink to="/admin/model" onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>Model tuning</NavLink>
            <div className="rail-label">Your workspace</div>
            <NavLink to="/dashboard" onClick={close}>Customer app →</NavLink>
            <div className="spacer" />
            <div className="faint" style={{ padding: '0 10px' }}>{profile?.email}</div>
            <a href="#signout" onClick={(e) => { e.preventDefault(); close(); signOut(); }}>Sign out</a>
          </div>
          {menuOpen && <div className="rail-backdrop" onClick={close} />}
        </nav>
        <main className="main fade-in">
          <Routes>
            <Route path="/admin/orgs" element={<AdminOrgs />} />
            <Route path="/admin/orgs/:id" element={<AdminOrgDetail />} />
            <Route path="/admin/health" element={<AdminHealth />} />
            <Route path="/admin/billing" element={<AdminBilling />} />
            <Route path="/admin/audit" element={<AdminAudit />} />
            <Route path="/admin/model" element={<AdminModel />} />
            <Route path="*" element={<Navigate to="/admin/orgs" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
