// Playbook bridge — the CJS seam between the SaaS's Netlify functions and the
// isomorphic organic engine in src/engine (ESM; esbuild handles the interop).
// Owns: the crawler, the row<->page mapping, value-per-click derivation from the
// org's REAL paid data, and the analysis wrapper that threads admin model settings.

const { parsePage, MONEY_HINTS } = require('../../../src/engine/parse.js');
const { pageToRow, rowToPage } = require('../../../src/engine/rows.js');
const { analyze } = require('../../../src/engine/index.js');
const { loadModelSettings } = require('./model-settings');

const UA = 'Mozilla/5.0 (compatible; ClarifySearch/1.0; +https://clarifypaidsearch.com)';

async function fetchText(url, timeout = 8000) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeout) });
  return { status: res.status, finalUrl: res.url, text: res.ok ? (await res.text()).slice(0, 900000) : '' };
}

// crawl: sitemap-seeded, money pages first, small and polite; parser = the engine's.
async function crawlDeep(siteUrl, { maxPages = 14 } = {}) {
  const origin = new URL(siteUrl).origin;
  const norm = (u) => u.replace(/\/$/, '') || origin;
  const seeds = new Set([norm(origin + '/')]);
  try {
    const sm = await fetchText(`${origin}/sitemap.xml`, 6000);
    if (sm.status === 200) {
      let locs = [...sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
      const children = locs.filter((l) => /\.xml(\?|$)/i.test(l)).slice(0, 2);
      if (children.length && children.length === locs.length) {
        locs = [];
        for (const c of children) {
          const child = await fetchText(c, 5000).catch(() => ({ text: '' }));
          locs.push(...[...child.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]));
        }
      }
      const sameHost = locs.filter((u) => { try { return new URL(u).origin === origin; } catch { return false; } });
      const money = sameHost.filter((u) => MONEY_HINTS.test(new URL(u).pathname));
      const rest = sameHost.filter((u) => !MONEY_HINTS.test(new URL(u).pathname));
      for (const u of [...money, ...rest]) { if (seeds.size >= maxPages * 2) break; seeds.add(norm(u)); }
    }
  } catch { /* no sitemap — homepage links will feed the queue */ }

  const pages = [];
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length && pages.length < maxPages) {
    const batch = queue.splice(0, 4).filter((u) => !seen.has(u));
    batch.forEach((u) => seen.add(u));
    const results = await Promise.allSettled(batch.map(async (u) => {
      const { status, finalUrl, text } = await fetchText(u);
      if (!text) return { url: u, path: safePath(u), status_code: status, failed: true, outlinks: [], schema_types: [], questions: [], h2s: [], phones: [], images: 0, images_missing_alt: 0, word_count: 0, h1_count: 0, title_length: 0, role: 'other' };
      const page = parsePage(norm(finalUrl), text, origin);
      page.status_code = status;
      return page;
    }));
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      pages.push(r.value);
      for (const link of (r.value.outlinks || [])) {
        const n = norm(link);
        if (!seen.has(n) && !queue.includes(n) && (seen.size + queue.length) < maxPages * 3) {
          MONEY_HINTS.test(safePath(n)) ? queue.unshift(n) : queue.push(n);
        }
      }
    }
  }
  return pages;
}
function safePath(u) { try { return new URL(u).pathname; } catch { return '/'; } }


// value-per-click from the org's real paid data; falls back to the tunable default.
async function deriveVpc(db, orgId, thresholds) {
  const { data: conns } = await db.from('google_ads_connections').select('id')
    .eq('org_id', orgId).eq('status', 'active').limit(1);
  if (conns?.length) {
    const { data: t } = await db.from('search_term_stats')
      .select('cost_micros, clicks').eq('connection_id', conns[0].id).limit(3000);
    const cost = (t || []).reduce((s, x) => s + Number(x.cost_micros || 0), 0);
    const clicks = (t || []).reduce((s, x) => s + Number(x.clicks || 0), 0);
    if (clicks >= 30 && cost > 0) return { vpc: Math.round((cost / clicks / 1e6) * 100) / 100, source: 'paid' };
  }
  return { vpc: thresholds.value_per_click_default ?? 4, source: 'default' };
}

// one call: settings + vpc + brand -> full analysis, plus the sub blob to store.
async function runPlaybook(db, orgId, { pages, queries }) {
  const settings = await loadModelSettings(db, orgId);
  const t = settings.weights.thresholds;
  const vpcInfo = await deriveVpc(db, orgId, t);
  const { data: orgs } = await db.from('organizations').select('name').eq('id', orgId).limit(1);
  const analysis = analyze({
    pages, queries,
    opts: { valuePerClick: vpcInfo.vpc, brandName: orgs?.[0]?.name || '', thresholds: t },
    weights: settings.weights,
  });
  const sub = {
    scores: analysis.scores,
    pipeline_value: analysis.demandMeta?.pipeline_value ?? null,
    capture_rate: analysis.demandMeta?.capture_rate ?? null,
    clicks_month: analysis.demandMeta?.clicks_month ?? null,
    value_per_click: vpcInfo.vpc, vpc_source: vpcInfo.source,
    top_tasks: analysis.tasks.slice(0, 6).map((x) => ({
      title: x.title, pillar: x.pillar, effort: x.effort, value_month: x.value_month, forge: x.fix?.forge || null,
    })),
    model_version: settings.version,
  };
  return { analysis, sub, settings, vpcInfo };
}

module.exports = { crawlDeep, pageToRow, rowToPage, deriveVpc, runPlaybook };
