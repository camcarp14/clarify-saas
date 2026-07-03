import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AdminOrgs from './AdminOrgs';
import AdminOrgDetail from './AdminOrgDetail';
import AdminHealth from './AdminHealth';
import AdminBilling from './AdminBilling';
import AdminAudit from './AdminAudit';

// The internal console shell — same layout primitives as the customer app, its own
// nav, and an unmissable ADMIN strip so a screen-share never confuses the two.
export default function AdminArea() {
  const { isAdmin, profile, signOut } = useAuth();
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return (
    <div>
      <div className="admin-top">CLARIFY ADMIN — internal console. Every action here is logged.</div>
      <div className="shell">
        <nav className="rail">
          <div className="brand">Clari<em>fy</em> <span className="faint" style={{ fontSize: 11 }}>admin</span></div>
          <NavLink to="/admin/orgs" className={({ isActive }) => (isActive ? 'active' : '')}>Organizations</NavLink>
          <NavLink to="/admin/health" className={({ isActive }) => (isActive ? 'active' : '')}>System health</NavLink>
          <NavLink to="/admin/billing" className={({ isActive }) => (isActive ? 'active' : '')}>Billing</NavLink>
          <NavLink to="/admin/audit" className={({ isActive }) => (isActive ? 'active' : '')}>Audit trail</NavLink>
          <div className="rail-label">Your workspace</div>
          <NavLink to="/dashboard">Customer app →</NavLink>
          <div className="spacer" />
          <div className="faint" style={{ padding: '0 10px' }}>{profile?.email}</div>
          <a href="#signout" onClick={(e) => { e.preventDefault(); signOut(); }}>Sign out</a>
        </nav>
        <main className="main fade-in">
          <Routes>
            <Routes>
              <Route path="/admin/orgs" element={<AdminOrgs />} />
              <Route path="/admin/orgs/:id" element={<AdminOrgDetail />} />
              <Route path="/admin/health" element={<AdminHealth />} />
              <Route path="/admin/billing" element={<AdminBilling />} />
              <Route path="/admin/audit" element={<AdminAudit />} />
              <Route path="*" element={<Navigate to="/admin/orgs" replace />} />
            </Routes>
        </main>
      </div>
    </div>
  );
}
