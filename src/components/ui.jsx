import { useState, useEffect, useRef, createContext, useContext } from 'react';

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

export function Empty({ title, children, body, action, compact }) {
  // compact: for use inside an already-bordered .section (e.g. Dashboard's
  // collapsible cards) — skips the redundant card-in-a-card chrome and padding
  // that otherwise stacks up to ~130px of dead space before any text appears.
  return (
    <div className={compact ? undefined : 'section'} style={{ textAlign: 'center', padding: compact ? '8px 12px 20px' : 40 }}>
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

// ---------- Clarify Search additions ----------

// The instrument: an SVG score ring. channel: 'paid' | 'organic' | undefined (ink).
export function Ring({ score, size = 96, channel, cap }) {
  const s = Math.max(0, Math.min(100, Number(score ?? 0)));
  const shown = useTween(score == null ? null : s);
  const stroke = size >= 90 ? 7 : 6;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const color = channel === 'paid' ? 'var(--paid)' : channel === 'organic' ? 'var(--org)' : channel === 'both' ? 'url(#ringgrad)' : 'var(--ink)';
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${cap || 'Score'}: ${score == null ? 'no data' : `${s} out of 100`}`}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id="ringgrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4fd694" /><stop offset="100%" stopColor="#f0a93b" />
          </linearGradient>
        </defs>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className="fill" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          stroke={score == null ? 'var(--line)' : color} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C - (C * s) / 100} />
      </svg>
      <div className="ring-num" style={{ fontSize: size * 0.3, color: score == null ? 'var(--ink-faint)' : 'var(--ink)' }}>
        {score == null ? '—' : shown}
      </div>
      {cap && <div className="ring-cap">{cap}</div>}
    </div>
  );
}

// Channel tabs: Paid / Organic / Overlap — each carries its color in the underline.
export function ChannelTabs({ value, onChange, items }) {
  return (
    <div className="chtabs" role="tablist" aria-label="Channel">
      {items.map(({ k, label }) => (
        <button key={k} role="tab" aria-selected={value === k}
          className={`t-${k}${value === k ? ' on' : ''}`} onClick={() => onChange(k)}>
          <span className="cdot" aria-hidden="true" />{label}
        </button>
      ))}
    </div>
  );
}

// Minimal markdown for AI briefs: ## headings, numbered + bulleted lists, **bold**.
// Deliberately tiny — briefs are structured by our own prompt, not arbitrary md.
function inlineBold(text, keyBase) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\*\*([^*]+)\*\*$/);
    if (!m) return p;
    const tag = m[1].match(/^\[(Paid|Organic|Both)\]$/i);
    if (tag) return <span key={`${keyBase}-${i}`} className={`chtag ${tag[1].toLowerCase()}`}>{tag[1]}</span>;
    return <strong key={`${keyBase}-${i}`}>{m[1]}</strong>;
  });
}
export function Md({ text }) {
  if (!text) return null;
  const lines = String(text).split('\n');
  const out = [];
  let list = null; // { type: 'ol'|'ul', items: [] }
  const flush = () => {
    if (!list) return;
    const L = list.type === 'ol' ? 'ol' : 'ul';
    out.push(<L key={`l${out.length}`}>{list.items.map((it, i) => <li key={i}>{it}</li>)}</L>);
    list = null;
  };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const h = line.match(/^#{2,3}\s+(.*)/);
    const num = line.match(/^\d+[.)]\s+(.*)/);
    const bul = line.match(/^[-*]\s+(.*)/);
    if (h) { flush(); out.push(<h3 key={idx} className="brief-h">{inlineBold(h[1], idx)}</h3>); }
    else if (num) { if (!list || list.type !== 'ol') { flush(); list = { type: 'ol', items: [] }; } list.items.push(inlineBold(num[1], idx)); }
    else if (bul) { if (!list || list.type !== 'ul') { flush(); list = { type: 'ul', items: [] }; } list.items.push(inlineBold(bul[1], idx)); }
    else if (line.trim()) { flush(); out.push(<p key={idx}>{inlineBold(line, idx)}</p>); }
    else flush();
  });
  flush();
  return <div>{out}</div>;
}

export const PillarTag = ({ pillar }) => pillar
  ? <span className={`chtag ${pillar}`}>{pillar === 'ai' ? 'AI readiness' : pillar}</span>
  : null;

export function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn small ghost" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); }
      catch { window.prompt('Copy:', text); }
    }}>{done ? 'Copied \u2713' : label}</button>
  );
}

export function Artifact({ title, text, children }) {
  return (
    <div className="artifact">
      <div className="a-head"><span className="t">{title}</span>{text != null && <CopyBtn text={text} />}</div>
      {children || <pre>{text}</pre>}
    </div>
  );
}

// ---------- polish primitives ----------
// rAF tween: numbers count to their value with ease-out. null renders nothing.
export function useTween(target, dur = 700) {
  const [v, setV] = useState(target ?? 0);
  const fromRef = useRef(target ?? 0);
  useEffect(() => {
    if (target == null) return;
    const from = fromRef.current ?? 0;
    if (from === target) { setV(target); return; }
    let raf; const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setV(from + (target - from) * e);
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return target == null ? null : Math.round(v);
}
export function Num({ v, f = (x) => x.toLocaleString('en-US'), dur }) {
  const shown = useTween(typeof v === 'number' ? v : null, dur);
  if (shown == null) return <>—</>;
  return <>{f(shown)}</>;
}

// skeletons: layout-matched loading, never a centered spinner for a page
export const SkLine = ({ w }) => <div className={`sk sk-line${w ? ` ${w}` : ''}`} />;
export function SkCard({ big = true }) {
  return (
    <div className="card">
      <SkLine w="w40" />
      {big && <div className="sk sk-big" />}
      <SkLine w="w80" />
    </div>
  );
}
export function SkPage({ cards = 4, rings = 0 }) {
  return (
    <div className="pagefade">
      <div style={{ display: 'flex', gap: 26, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 16px' }}>
        {Array.from({ length: rings }).map((_, i) => (
          <div key={i} className="sk sk-ring" style={{ width: 84, height: 84 }} />
        ))}
        {rings > 0 && <div style={{ flex: 1, minWidth: 180 }}><SkLine w="w60" /><SkLine w="w80" /></div>}
      </div>
      <div className="grid">{Array.from({ length: cards }).map((_, i) => <SkCard key={i} />)}</div>
      <div className="section"><SkLine w="w40" /><SkLine /><SkLine w="w80" /><SkLine w="w60" /></div>
    </div>
  );
}

// smooth expand/collapse without measuring
export function Expand({ open, children }) {
  return <div className={`expand${open ? ' open' : ''}`} aria-hidden={!open}><div>{open ? children : null}</div></div>;
}

// toasts
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = (msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, msg, err: !!opts.err }]);
    setTimeout(() => setItems((xs) => xs.map((x) => x.id === id ? { ...x, out: true } : x)), opts.ms || 2600);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), (opts.ms || 2600) + 260);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.err ? ' err' : ''}${t.out ? ' out' : ''}`}><span className="tdot" />{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx) || (() => {});
