// The Demand engine — where Search Console data turns into dollar figures.
// Savant's core move: price every organic gap in the currency owners already
// understand — what those clicks would cost in Google Ads (value-per-click).
// No GSC import → this whole pillar politely sits out; nothing pretends.

import { tokens, overlap, norm } from './parse.js';
import { expectedCtr, clickGap, ctrShortfall, monthly, usd } from './ctr.js';

const d = (category, severity, title, summary, recommendation, evidence, fix, value) =>
  ({ category, pillar: 'demand', severity, title, summary, recommendation, evidence, fix, value_month: value || 0 });

export function diagnoseDemand({ queries, model, opts, targetPos = 3 }) {
  if (!queries?.length) return { findings: [], meta: null };
  const vpc = Number(opts.valuePerClick) || 0;
  const brandTokens = tokens(opts.brandName || model.home?.title || '');
  const isBrand = (q) => brandTokens.size && overlap(tokens(q), brandTokens) >= 0.5;
  const nonBrand = queries.filter((q) => !isBrand(q.query));
  const out = [];

  // ---- striking distance: pos 4–15, priced ----
  const striking = nonBrand
    .map((q) => ({ ...q, gap: clickGap(q, targetPos) }))
    .filter((q) => q.position >= 4 && q.position <= 15 && q.impressions >= 30 && q.gap > 0)
    .sort((a, b) => b.gap - a.gap);
  const strikeClicks = striking.reduce((s, q) => s + q.gap, 0);
  const strikeValue = monthly(strikeClicks, vpc);
  if (striking.length >= 2) {
    out.push(d('striking_distance', strikeValue > 800 ? 'critical' : 'warning',
      vpc ? `${usd(strikeValue)}/mo sits between positions 4 and 15` : `${strikeClicks.toLocaleString()} clicks/mo sit between positions 4 and 15`,
      `${striking.length} queries — led by "${striking[0].query}" (position ${striking[0].position.toFixed(1)}, ${striking[0].impressions.toLocaleString()} impressions) — already half-rank. Moving them into the top spots is worth ~${strikeClicks.toLocaleString()} clicks/mo${vpc ? `, which would cost ${usd(strikeValue)} to buy at your ${usd(vpc)} value-per-click` : ''}. These are the cheapest wins in organic: the pages exist and Google half-believes them.`,
      'Per query: deepen the ranking page (brief in the Fix Forge), add the buyer FAQs, and point 2–3 internal links at it. Re-check in 21 days.',
      { window: 'GSC import (typically last 3 months)',
        formula: `gap = impressions × CTR(target pos ${targetPos}) − clicks · $ = gap × value-per-click (${usd(vpc)})`,
        inputs: { queries_in_range: striking.length, target_position: targetPos, value_per_click: usd(vpc) },
        result: { monthly_click_gap: strikeClicks, monthly_value: usd(strikeValue), top: striking.slice(0, 10).map((q) => ({ query: q.query, position: +q.position.toFixed(1), impressions: Math.round(q.impressions), clicks_gap: q.gap, value: usd(monthly(q.gap, vpc)) })) } },
      { forge: 'brief', queries: striking.slice(0, 10).map((q) => q.query) }, strikeValue));
  }

  // ---- CTR shortfall: ranking fine, losing the click ----
  const short = nonBrand
    .map((q) => ({ ...q, miss: ctrShortfall(q) }))
    .filter((q) => q.miss > 0 && q.impressions >= 100)
    .sort((a, b) => b.miss - a.miss);
  const missClicks = short.reduce((s, q) => s + q.miss, 0);
  const missValue = monthly(missClicks, vpc);
  if (short.length) {
    out.push(d('ctr_gap', 'warning',
      vpc ? `${usd(missValue)}/mo of rankings aren't earning their clicks` : `${missClicks.toLocaleString()} clicks/mo of rankings aren't earning their clicks`,
      `"${short[0].query}" sits at position ${short[0].position.toFixed(1)} with ${Math.round(short[0].impressions).toLocaleString()} impressions and only ${Math.round(short[0].clicks)} clicks — well under that spot's normal take. The ranking work is done; the title and snippet are losing the auction for attention. Rewrites are drafted in the Fix Forge.`,
      'Ship the rewritten titles/descriptions like ads: outcome, area, differentiator. Rankings unchanged, clicks up inside two weeks.',
      { window: 'GSC import',
        formula: 'shortfall = impressions × CTR(position) − clicks, flagged when actual < 45% of norm',
        inputs: { queries_flagged: short.length, value_per_click: usd(vpc) },
        result: { monthly_click_shortfall: missClicks, monthly_value: usd(missValue), top: short.slice(0, 8).map((q) => ({ query: q.query, position: +q.position.toFixed(1), impressions: Math.round(q.impressions), ctr: `${(q.ctr * 100).toFixed(1)}%`, expected: `${(expectedCtr(q.position) * 100).toFixed(1)}%` })) } },
      { forge: 'titles', queries: short.slice(0, 8).map((q) => q.query) }, missValue));
  }

  // ---- page-two graveyard: pos 11–20, high demand ----
  const graveyard = nonBrand.filter((q) => q.position > 15 && q.position <= 25 && q.impressions >= 100)
    .sort((a, b) => b.impressions - a.impressions);
  if (graveyard.length >= 3) {
    const potential = graveyard.reduce((s, q) => s + Math.round(q.impressions * expectedCtr(3)), 0);
    out.push(d('page_two', 'opportunity',
      `${graveyard.length} high-demand queries are parked on page two`,
      `Terms like "${graveyard[0].query}" (${Math.round(graveyard[0].impressions).toLocaleString()} impressions, position ${graveyard[0].position.toFixed(1)}) prove the demand exists — Google just doesn't believe the current pages enough. These need real content investment, not tweaks: worth ~${potential.toLocaleString()} clicks/mo${vpc ? ` (${usd(monthly(potential, vpc))})` : ''} if won.`,
      'Treat each as a content project from the Fix Forge brief: a genuinely deeper page plus internal links. Slower than striking-distance wins; bigger when they land.',
      { window: 'GSC import', formula: 'position 15–25 with ≥100 impressions; potential = impressions × CTR(pos 3)',
        inputs: { queries_flagged: graveyard.length },
        result: { potential_clicks_month: potential, top: graveyard.slice(0, 8).map((q) => ({ query: q.query, position: +q.position.toFixed(1), impressions: Math.round(q.impressions) })) } },
      { forge: 'brief', queries: graveyard.slice(0, 8).map((q) => q.query) }, monthly(potential, vpc) * 0.5));
  }

  // ---- coverage: demand with no matching page at all ----
  const pageFps = model.pages.map((p) => ({ p, fp: p.fingerprint }));
  const uncovered = nonBrand
    .filter((q) => q.impressions >= 50 && q.position > 10)
    .filter((q) => { const qt = tokens(q.query); return !pageFps.some(({ fp }) => overlap(qt, fp) >= 0.6); })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
  if (uncovered.length >= 2) {
    out.push(d('coverage', 'opportunity',
      `${uncovered.length} demand streams have no page built for them`,
      `Searches like "${uncovered[0].query}" (${Math.round(uncovered[0].impressions).toLocaleString()} impressions/mo) reach the site by accident — nothing crawled actually targets them. Each is a pre-validated page waiting to exist; briefs are in the Fix Forge.`,
      'Build one dedicated page per stream, biggest impressions first.',
      { window: 'GSC import + this crawl', formula: 'queries ≥50 impressions, position >10, no crawled page with ≥0.6 topical match',
        inputs: { queries_checked: nonBrand.length, pages_in_crawl: model.pages.length },
        result: { uncovered: uncovered.map((q) => ({ query: q.query, impressions: Math.round(q.impressions), position: +q.position.toFixed(1) })) } },
      { forge: 'brief', queries: uncovered.map((q) => q.query) }, 0));
  }

  // ---- brand dependence ----
  const brandClicks = queries.filter((q) => isBrand(q.query)).reduce((s, q) => s + q.clicks, 0);
  const allClicks = queries.reduce((s, q) => s + q.clicks, 0);
  const brandShare = allClicks ? brandClicks / allClicks : 0;
  if (allClicks >= 50 && brandShare > 0.7) {
    out.push(d('brand_mix', 'opportunity', `${Math.round(brandShare * 100)}% of organic clicks are people who already knew you`,
      `Branded searches dominate the click mix. That traffic is loyalty, not acquisition — the growth channel is the non-brand share, and right now it's ${Math.round((1 - brandShare) * 100)}%.`,
      'Every task in this report grows the non-brand share; track the split monthly as the honest organic-growth KPI.',
      { window: 'GSC import', formula: 'brand-matching query clicks ÷ all clicks',
        inputs: { brand_tokens: [...brandTokens].slice(0, 4), total_clicks: Math.round(allClicks) },
        result: { brand_share: `${Math.round(brandShare * 100)}%` } }, null, 0));
  }

  // capture rate for the scoreboard
  const gapTotal = nonBrand.reduce((s, q) => s + clickGap(q, targetPos), 0);
  const captured = nonBrand.reduce((s, q) => s + q.clicks, 0);
  const captureRate = (captured + gapTotal) > 0 ? captured / (captured + gapTotal) : null;

  return {
    findings: out,
    meta: {
      queries: queries.length,
      non_brand: nonBrand.length,
      clicks_month: Math.round(allClicks),
      capture_rate: captureRate,
      pipeline_value: strikeValue + missValue,
      value_per_click: vpc,
    },
  };
}

export { usd };
