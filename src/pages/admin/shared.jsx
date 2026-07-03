// Shared bits for the admin console. PRICE mirrors src/pages/Settings.jsx TIERS —
// if you change pricing there, change it here (single-source refactor = future pass).
export const PRICE = { starter: 149, growth: 399, pro: 699 };
export const TIERS = ['starter', 'growth', 'pro'];

export const usd0 = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// Risk derivation — same rules the old Admin.jsx used, now shared.
export function riskFor(org, { lastSeen, conns = [], criticals = [] } = {}) {
  const risks = [];
  const trialDays = org.trial_ends_at ? Math.ceil((new Date(org.trial_ends_at) - Date.now()) / 86400000) : null;
  if (org.suspended_at) risks.push(['act', 'suspended']);
  if (org.subscription_status === 'past_due') risks.push(['act', 'past due']);
  if (org.subscription_status === 'trialing' && !org.stripe_subscription_id && trialDays != null && trialDays <= 3)
    risks.push(['watch', trialDays < 0 ? 'trial expired' : `trial ends ${trialDays}d`]);
  if (lastSeen && Date.now() - new Date(lastSeen) > 14 * 86400000) risks.push(['watch', 'no login 14d+']);
  if (!lastSeen) risks.push(['watch', 'never logged in']);
  if (conns.some((c) => c.status === 'error')) risks.push(['act', 'sync failing']);
  if (criticals.some((f) => f.category === 'conversion_tracking')) risks.push(['act', 'tracking broken']);
  return risks;
}

export const RiskChips = ({ risks }) => (
  <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
    {risks.length === 0 && <span className="chip pass">healthy</span>}
    {risks.map(([tone, label], i) => (
      <span key={i} className={`chip ${tone === 'act' ? 'critical' : 'warning'}`}>{label}</span>
    ))}
  </span>
);
