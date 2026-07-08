// Clarify overlap engine — where the two channels meet.
// This is the product's thesis in code: one results page, two ways in.
// Joins paid search terms against Search Console queries and the crawled page set.
// Same evidence-first contract as both audit engines.

const usd = (micros) => `$${(Number(micros || 0) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
const similar = (a, b) => {
  if (a === b) return true;
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let hit = 0;
  for (const w of ta) if (tb.has(w)) hit++;
  return hit / Math.max(ta.size, tb.size) >= 0.75;
};

function runOverlap({ terms = [], queries = [], pages = [], weights }) {
  const t = weights.thresholds;
  const paid = terms
    .map((x) => ({ term: norm(x.term), raw: x.term, cost: Number(x.cost_micros || 0), clicks: Number(x.clicks || 0), conv: Number(x.conversions || 0) }))
    .filter((x) => x.term && x.cost > 0);
  const org = queries
    .map((q) => ({ query: norm(q.query), raw: q.query, position: Number(q.position || 99), clicks: Number(q.clicks || 0), impressions: Number(q.impressions || 0) }))
    .filter((q) => q.query);
  const orgByQuery = new Map(org.map((q) => [q.query, q]));

  // ---- 1) Buying clicks you already earn ----
  const overlaps = [];
  for (const p of paid) {
    let match = orgByQuery.get(p.term);
    if (!match) match = org.find((q) => q.position <= t.organic_top_position && similar(q.query, p.term));
    if (match && match.position <= t.organic_top_position) {
      overlaps.push({ term: p.raw, paid_spend_30d: p.cost, organic_position: Math.round(match.position * 10) / 10, organic_clicks_28d: Math.round(match.clicks) });
    }
  }
  overlaps.sort((a, b) => b.paid_spend_30d - a.paid_spend_30d);
  const overlapSpend = overlaps.reduce((s, o) => s + o.paid_spend_30d, 0);
  const reclaimable = Math.round((overlapSpend * t.overlap_reclaim_factor) / 1e6) * 1e6;

  // ---- 2) Content gaps: paid proves demand, organic has nothing there ----
  const winners = paid.filter((p) => p.conv >= 2).sort((a, b) => b.conv - a.conv);
  const pageText = pages.filter((pg) => !pg.failed).map((pg) => ({ page: pg.url, blob: norm(`${pg.title || ''} ${pg.h1 || ''} ${pg.path || ''}`) }));
  const gaps = [];
  for (const w of winners.slice(0, 40)) {
    const ranks = org.some((q) => q.position <= 20 && similar(q.query, w.term));
    const hasPage = pageText.some((pg) => {
      const tw = tokens(w.term);
      let hit = 0; for (const wd of tw) if (pg.blob.includes(wd)) hit++;
      return tw.size && hit / tw.size >= 0.6;
    });
    if (!ranks && !hasPage) {
      gaps.push({ term: w.raw, conversions_30d: Math.round(w.conv), paid_spend_30d: usd(w.cost) });
      if (gaps.length >= 10) break;
    }
  }

  // ---- 3) Organic winners paid can stop defending ----
  const freeWins = org
    .filter((q) => q.position <= t.organic_top_position && q.clicks >= 10)
    .filter((q) => !paid.some((p) => similar(p.term, q.query)))
    .sort((a, b) => b.clicks - a.clicks).slice(0, 8)
    .map((q) => ({ query: q.raw, position: Math.round(q.position * 10) / 10, organic_clicks_28d: Math.round(q.clicks) }));

  const findings = [];
  const f = (category, severity, title, summary, recommendation, evidence) =>
    findings.push({ category, severity, title, summary, recommendation, evidence });

  if (overlaps.length) {
    f('paid_organic_overlap', overlapSpend > 500e6 ? 'critical' : 'warning',
      `${usd(overlapSpend)} of ad spend is buying clicks you already earn`,
      `${overlaps.length} paid search terms rank organically in the top ${t.organic_top_position} — led by "${overlaps[0].term}" (${usd(overlaps[0].paid_spend_30d)} paid last 30 days, ranking #${overlaps[0].organic_position}). You appear twice on those results pages and pay for one of them. Roughly ${usd(reclaimable)} of that is reclaimable, redeployed to terms where you *don't* rank.`,
      `Test pausing or bid-capping the top overlap terms one at a time, watching total (paid + organic) clicks in the change log — the honest way to bank the ${usd(reclaimable)}.`,
      {
        window: 'Paid: last 30 days · Organic: last 28 days',
        formula: `overlap = paid terms whose matching query ranks ≤ ${t.organic_top_position} organically; reclaimable = overlap spend × ${t.overlap_reclaim_factor}`,
        inputs: { paid_terms_analyzed: paid.length, organic_queries_analyzed: org.length },
        result: { overlap_terms: overlaps.slice(0, 10).map((o) => ({ ...o, paid_spend_30d: usd(o.paid_spend_30d) })), overlap_spend_30d: usd(overlapSpend), est_reclaimable: usd(reclaimable) },
      });
  } else if (org.length && paid.length) {
    f('paid_organic_overlap', 'pass', 'Paid isn\u2019t double-paying for organic wins',
      `None of your paid terms meaningfully collide with queries you already rank top-${t.organic_top_position} for.`, null,
      { window: 'Paid 30d · Organic 28d', formula: `paid terms vs organic queries ranking ≤ ${t.organic_top_position}`, inputs: { paid_terms_analyzed: paid.length, organic_queries_analyzed: org.length }, result: { overlap_terms: [] } });
  }

  if (gaps.length) {
    f('content_gaps', 'opportunity',
      `Paid has proven ${gaps.length} winners organic hasn\u2019t built for`,
      `Terms like "${gaps[0].term}" convert in paid (${gaps[0].conversions_30d} conversions/30d) but you neither rank nor have a matching page. Your ad spend already ran the experiment — these are pre-validated topics for the content roadmap, each one a page that eventually earns what you currently rent.`,
      'Build one dedicated page per gap term, in priority order of paid conversions. Paid keeps the demand while organic catches up.',
      {
        window: 'Paid: last 30 days · Organic: last 28 days + crawl',
        formula: 'paid terms with ≥2 conversions AND no organic ranking ≤20 AND no crawled page matching the term',
        inputs: { converting_terms_checked: winners.length, pages_in_crawl: pageText.length },
        result: { content_gaps: gaps },
      });
  }

  if (freeWins.length) {
    f('free_wins', 'opportunity',
      `${freeWins.length} organic winners are carrying weight paid never touches`,
      `Queries like "${freeWins[0].query}" bring ${freeWins[0].organic_clicks_28d} organic clicks a month from position ${freeWins[0].position} with zero ad support. Nothing to fix — but these rankings are assets: protect the pages behind them, and skip the temptation to "top up" with ads.`,
      'List the pages behind these queries as protected: no rewrites without re-checking rankings, and keep internal links pointed at them.',
      {
        window: 'Organic: last 28 days',
        formula: `queries ranking ≤ ${t.organic_top_position} with ≥10 clicks and no matching paid term`,
        inputs: { organic_queries_analyzed: org.length },
        result: { organic_only_winners: freeWins },
      });
  }

  return {
    findings,
    summary: {
      overlap_terms: overlaps.length,
      overlap_spend_micros: overlapSpend,
      reclaimable_micros: reclaimable,
      content_gaps: gaps.length,
      free_wins: freeWins.length,
      paid_terms: paid.length,
      organic_queries: org.length,
    },
  };
}

module.exports = { runOverlap };
