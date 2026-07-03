import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Spinner, Empty } from '../../components/ui';
import { timeAgo } from '../../lib/format';

// The accountability trail: every admin mutation, who did it, to whom, with what.
export default function AdminAudit() {
  const [rows, setRows] = useState(null);
  const [actors, setActors] = useState({});
  const [orgs, setOrgs] = useState({});
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      const [{ data: log }, { data: profiles }, { data: orgRows }] = await Promise.all([
        supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.from('profiles').select('id, email'),
        supabase.from('organizations').select('id, name'),
      ]);
      setActors(Object.fromEntries((profiles || []).map((p) => [p.id, p.email])));
      setOrgs(Object.fromEntries((orgRows || []).map((o) => [o.id, o.name])));
      setRows(log || []);
    })();
  }, []);
  if (!rows) return <Spinner />;

  const shown = q ? rows.filter((r) => `${r.action} ${r.target} ${actors[r.actor_id] || ''}`.toLowerCase().includes(q.toLowerCase())) : rows;

  return (
    <div>
      <div className="row-between">
        <h1>Audit trail</h1>
        <input placeholder="Filter by action, target, actor…" style={{ maxWidth: 280 }} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="muted">Last 200 entries. Every admin write in the product lands here — no exceptions.</p>
      {shown.length === 0 && <Empty title="Nothing logged yet">Admin actions will appear here the moment one happens.</Empty>}
      <table className="plain" style={{ marginTop: 12 }}>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              <td className="faint" style={{ whiteSpace: 'nowrap', width: 90 }}>{timeAgo(r.created_at)}</td>
              <td className="mono" style={{ fontSize: 12.5 }}>{r.action}</td>
              <td>{r.target}</td>
              <td>{r.org_id && orgs[r.org_id] ? <Link to={`/admin/orgs/${r.org_id}`}>{orgs[r.org_id]}</Link> : <span className="faint">—</span>}</td>
              <td className="faint">{actors[r.actor_id] || r.actor_id?.slice(0, 8)}</td>
              <td className="faint mono" style={{ fontSize: 11 }}>{r.meta && Object.keys(r.meta).length ? JSON.stringify(r.meta).slice(0, 60) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
