export const usd = (micros) =>
  `$${(Number(micros || 0) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
export const usdN = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
export const pct = (x) => `${Math.round(Number(x || 0) * 100)}%`;
export const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const dayLabel = (d) => {
  const [, m, day] = String(d).split('-');
  return `${Number(m)}/${Number(day)}`;
};
export const timeAgo = (iso) => {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
export const dateShort = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
