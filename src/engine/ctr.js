// The money math. Position → expected organic CTR, blended 2025/26 curves.
// Every dollar figure in Savant traces back to these three functions —
// and every receipt prints the assumptions, so the math is arguable, not hidden.

const CURVE = [
  [1, 0.28], [2, 0.155], [3, 0.10], [4, 0.072], [5, 0.052],
  [6, 0.040], [7, 0.031], [8, 0.025], [9, 0.021], [10, 0.018],
  [12, 0.012], [15, 0.008], [20, 0.005], [30, 0.003], [50, 0.001],
];

export function expectedCtr(position) {
  const p = Math.max(1, Number(position) || 100);
  for (let i = 0; i < CURVE.length; i++) {
    const [pos, ctr] = CURVE[i];
    if (p <= pos) {
      if (i === 0) return ctr;
      const [p0, c0] = CURVE[i - 1];
      return c0 + ((p - p0) / (pos - p0)) * (ctr - c0);
    }
  }
  return 0.001;
}

// Clicks left on the table if this query moved to targetPos.
export function clickGap({ impressions, clicks, position }, targetPos = 3) {
  if (!impressions || position <= targetPos) return 0;
  const potential = impressions * expectedCtr(targetPos);
  return Math.max(0, Math.round(potential - clicks));
}

// CTR underperformance vs the position's norm (title/meta problem, not a ranking problem).
export function ctrShortfall({ impressions, clicks, position }) {
  if (!impressions || position > 10) return 0;
  const norm = impressions * expectedCtr(position);
  const actualShort = norm - clicks;
  return clicks < norm * 0.45 ? Math.max(0, Math.round(actualShort)) : 0;
}

export const monthly = (clicksGap, valuePerClick) => Math.round(clicksGap * (Number(valuePerClick) || 0));
export const usd = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
