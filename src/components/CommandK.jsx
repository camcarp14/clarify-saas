import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// ⌘K — the "this is real software" affordance. Navigation-first, zero deps.
const BASE = [
  { label: 'Dashboard', path: '/dashboard', k: ['home', 'morning'] },
  { label: 'Search · Overview', path: '/audit?tab=overview', k: ['holistic', 'blended', 'terms'] },
  { label: 'Search · Paid audit', path: '/audit?tab=paid', k: ['google ads', 'ppc'] },
  { label: 'Search · Organic audit', path: '/audit?tab=organic', k: ['seo', 'crawl'] },
  { label: 'Search · Overlap', path: '/audit?tab=overlap', k: ['cannibalization'] },
  { label: 'Playbook', path: '/playbook', k: ['sprint', 'tasks', 'fixes'] },
  { label: 'Alerts', path: '/alerts', k: ['monitoring'] },
  { label: 'Leads', path: '/leads', k: ['crm', 'pipeline'] },
  { label: 'Inbox', path: '/inbox', k: ['email', 'replies'] },
  { label: 'Sequences', path: '/sequences', k: ['outreach'] },
  { label: 'Discover', path: '/discover', k: ['prospect'] },
  { label: 'Settings', path: '/settings', k: ['billing', 'connections', 'gsc'] },
];
const ADMIN = [
  { label: 'Admin · Organizations', path: '/admin/orgs', k: ['support'] },
  { label: 'Admin · Model tuning', path: '/admin/model', k: ['weights', 'thresholds'] },
];

export default function CommandK({ isAdmin }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const inputRef = useRef(null);

  const items = useMemo(() => {
    const all = isAdmin ? [...BASE, ...ADMIN] : BASE;
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((x) => x.label.toLowerCase().includes(needle) || x.k.some((w) => w.includes(needle)));
  }, [q, isAdmin]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); setQ(''); setI(0); }
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 10); }, [open]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  useEffect(() => { setI(0); }, [q]);

  if (!open) return null;
  const go = (item) => { setOpen(false); nav(item.path); };

  return (
    <div className="cmdk-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="cmdk" role="dialog" aria-label="Command palette">
        <input ref={inputRef} value={q} placeholder="Jump to…" onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
            else if (e.key === 'Enter' && items[i]) go(items[i]);
          }} />
        <div className="list">
          {items.map((item, idx) => (
            <div key={item.path} className={`item${idx === i ? ' on' : ''}`}
              onMouseEnter={() => setI(idx)} onMouseDown={(e) => { e.preventDefault(); go(item); }}>
              <span>{item.label}</span><span className="k">↵</span>
            </div>
          ))}
          {items.length === 0 && <div className="item">Nothing matches “{q}”</div>}
        </div>
        <div className="hint"><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
      </div>
    </div>
  );
}
