import { useState } from 'react';

export function Verdict({ tone = 'info', children }) {
  return (
    <div className="verdict">
      <span className={`tick ${tone}`} />
      <span>{children}</span>
    </div>
  );
}

export function Chip({ severity }) {
  return <span className={`chip ${severity}`}>{severity}</span>;
}

function fmtVal(v) {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object' && !Array.isArray(v))
    return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(' · ');
  return String(v);
}

// The signature element: a receipt. Formula first, then inputs, then the result rows.
export function Receipt({ evidence }) {
  if (!evidence) return null;
  const rows = (obj, strong) => Object.entries(obj || {}).map(([k, v]) => (
    Array.isArray(v) ? (
      <div key={k}>
        <div className="row"><span>{strong ? <strong>{k}</strong> : k}</span><span>{v.length ? '' : 'none'}</span></div>
        {v.slice(0, 10).map((item, i) => (
          <div className="row" key={i} style={{ paddingLeft: 14 }}>
            <span>· {typeof item === 'object' ? Object.values(item).join(' — ') : String(item)}</span>
          </div>
        ))}
      </div>
    ) : (
      <div className="row" key={k}>
        <span>{strong ? <strong>{k}</strong> : k}</span>
        <span>{strong ? <strong>{fmtVal(v)}</strong> : fmtVal(v)}</span>
      </div>
    )
  ));
  return (
    <div className="receipt">
      <div className="formula">{evidence.formula}</div>
      {evidence.window && <div className="row"><span>window</span><span>{evidence.window}</span></div>}
      {rows(evidence.inputs, false)}
      {rows(evidence.result, true)}
    </div>
  );
}

export function ShowMath({ evidence }) {
  const [open, setOpen] = useState(false);
  if (!evidence) return null;
  return (
    <>
      <button className="showmath" onClick={() => setOpen(!open)}>
        {open ? '– hide the math' : '+ show the math'}
      </button>
      {open && <Receipt evidence={evidence} />}
    </>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="muted" style={{ padding: 32, textAlign: 'center' }}>{label}</div>;
}

export function Empty({ title, children, body, action }) {
  return (
    <div className="section" style={{ textAlign: 'center', padding: 40 }}>
      <h3>{title}</h3>
      <div className="muted" style={{ marginTop: 8, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>{children || body}</div>
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

// ---------- Outreach module additions ----------

// Lead temperature at a glance — the outreach counterpart to the audit's severity Chip.
export function Heat({ status }) {
  const cls = status === 'replied' || status === 'won' ? 'replied'
    : status === 'in_sequence' ? 'h2'
    : status === 'enriched' ? 'h1'
    : ['lost', 'unsubscribed', 'bounced'].includes(status) ? ''
    : 'h1';
  return <span className={`heat ${cls}`} title={status}><i /><i /><i /></span>;
}

export const Pill = ({ v }) => <span className={`pill ${v}`}>{String(v || '').replace('_', ' ')}</span>;

export function MergeChips({ onPick }) {
  const fields = ['first_name', 'company', 'website', 'city', 'signal'];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
      {fields.map((f) => (
        <button key={f} type="button" className="chipfield" onClick={() => onPick(`{{${f}}}`)}>{'{{'}{f}{'}}'}</button>
      ))}
    </div>
  );
}
