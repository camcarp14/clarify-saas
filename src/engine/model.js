// The Money Map — Savant's model of the site as a revenue machine.
// Pages get roles (home / money / content / trust / utility), the internal link
// graph gets depth + inbound counts, every money page gets a health grade, and
// pairs of money pages fighting over the same topic get flagged.

import { tokens, overlap } from './parse.js';

export function buildModel(pages) {
  const live = pages.filter((p) => !p.failed && p.status_code >= 200 && p.status_code < 400);
  const byUrl = new Map(live.map((p) => [p.url, p]));

  // inbound internal links within the crawl set
  const inbound = new Map();
  for (const p of live) for (const l of (p.outlinks || [])) {
    if (l !== p.url && byUrl.has(l)) inbound.set(l, (inbound.get(l) || 0) + 1);
  }

  // click depth: BFS from the homepage
  const home = live.find((p) => p.path === '/') || live[0];
  const depth = new Map();
  if (home) {
    depth.set(home.url, 0);
    let frontier = [home.url];
    while (frontier.length) {
      const next = [];
      for (const u of frontier) {
        const d = depth.get(u);
        for (const l of (byUrl.get(u)?.outlinks || [])) {
          if (byUrl.has(l) && !depth.has(l)) { depth.set(l, d + 1); next.push(l); }
        }
      }
      frontier = next;
    }
  }

  const enriched = live.map((p) => ({
    ...p,
    inbound: inbound.get(p.url) || 0,
    depth: depth.has(p.url) ? depth.get(p.url) : null, // null = unreachable from home within crawl
    fingerprint: tokens(`${p.title || ''} ${p.h1 || ''} ${p.path.replace(/[/-]/g, ' ')}`),
  }));

  // health grade per money page — the five things that decide whether a page can earn
  const grade = (p) => {
    const checks = {
      indexed: !p.noindex,
      titled: !!p.title && p.title_length >= 20 && p.title_length <= 65,
      substantial: p.word_count >= 300,
      linked: p.inbound > 0 || p.role === 'home',
      answerable: p.questions.length > 0 || p.has_faq_schema || (p.first_text || '').length > 200,
    };
    const score = Object.values(checks).filter(Boolean).length;
    return { checks, score, letter: ['F', 'D', 'C', 'B', 'A', 'A+'][score] };
  };
  for (const p of enriched) p.grade = grade(p);

  // internal competition: money pages whose fingerprints collide hard
  const money = enriched.filter((p) => p.role === 'money');
  const competition = [];
  for (let i = 0; i < money.length; i++) {
    for (let j = i + 1; j < money.length; j++) {
      const sim = overlap(money[i].fingerprint, money[j].fingerprint);
      if (sim >= 0.7) competition.push({ a: money[i].path, b: money[j].path, similarity: Math.round(sim * 100) / 100 });
    }
  }

  const failed = pages.filter((p) => p.failed || !p.status_code || p.status_code >= 400);
  return {
    pages: enriched,
    home,
    money,
    content: enriched.filter((p) => p.role === 'content'),
    failed,
    competition,
    stats: {
      crawled: pages.length,
      live: enriched.length,
      money_pages: money.length,
      avg_money_grade: money.length ? Math.round((money.reduce((s, p) => s + p.grade.score, 0) / money.length) * 10) / 10 : null,
      orphaned_money: money.filter((p) => p.inbound === 0).length,
      deep_money: money.filter((p) => p.depth != null && p.depth > 2).length,
    },
  };
}

// Best internal-link sources for a starved target: topical match × authority proxy.
export function linkSources(model, target, max = 3) {
  return model.pages
    .filter((p) => p.url !== target.url && !(p.outlinks || []).includes(target.url) && p.role !== 'utility')
    .map((p) => ({
      page: p,
      score: overlap(p.fingerprint, target.fingerprint) * 2 + (p.role === 'home' ? 1.2 : 0) + Math.min(p.inbound, 5) * 0.15 + (p.role === 'content' ? 0.3 : 0),
      anchor: [...target.fingerprint].slice(0, 3).join(' ') || target.h1 || target.path,
    }))
    .filter((s) => s.score > 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}
