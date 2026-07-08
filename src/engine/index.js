// Savant orchestrator — one call, the whole diagnosis.
// analyze({ pages, queries, opts }) → { model, findings, tasks, scores, demandMeta }
// Isomorphic: the standalone app calls this in the browser; the Clarify SaaS can
// call the exact same function inside a Netlify function against organic_pages +
// gsc_query_stats rows. That is the integration.

import { buildModel } from './model.js';
import { diagnoseFoundation, diagnoseAiReadiness } from './diagnose.js';
import { diagnoseDemand } from './demand.js';
import { buildTasks } from './sprint.js';

export const DEFAULT_THRESHOLDS = {
  target_position: 3,
  thin_content_words: 300,
  title_max_len: 62,
  title_min_len: 25,
  page_weight_bytes: 2500000,
};

const SEV_W = { critical: 18, warning: 8, opportunity: 3, pass: 0 };

export function analyze({ pages, queries = [], opts = {}, weights = {} }) {
  const t = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };
  const sevW = { ...SEV_W, ...(weights.severity || {}) };
  const catW = (weights.categories && weights.categories.organic) || {};
  const pillarScore = (findings, pillar) => {
    const fs = findings.filter((f) => f.pillar === pillar);
    if (!fs.length) return null;
    const penalty = fs.reduce((s, f) => s + (sevW[f.severity] || 0) * (catW[f.category] ?? 1), 0);
    return Math.max(5, Math.round(100 - penalty));
  };
  const model = buildModel(pages);

  const findings = [
    ...diagnoseFoundation(model, t),
    ...diagnoseAiReadiness(model),
  ];
  const demand = diagnoseDemand({ queries, model, opts, targetPos: t.target_position || 3 });
  findings.push(...demand.findings);

  const order = { critical: 0, warning: 1, opportunity: 2, pass: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || (b.value_month || 0) - (a.value_month || 0));

  // scores: four dials + one composite
  const foundation = pillarScore(findings, 'foundation');
  const ai = pillarScore(findings, 'ai');
  const demandScore = demand.meta?.capture_rate != null ? Math.round(demand.meta.capture_rate * 100) : null;
  const coverage = model.money.length
    ? Math.round((model.money.filter((p) => p.grade.score >= 4).length / model.money.length) * 100)
    : null;
  const parts = [foundation, demandScore, coverage, ai].filter((x) => x != null);
  const composite = parts.length ? Math.round(parts.reduce((s, x) => s + x, 0) / parts.length) : null;

  return {
    model,
    findings,
    tasks: buildTasks(findings),
    demandMeta: demand.meta,
    scores: { composite, foundation, demand: demandScore, coverage, ai },
    thresholds: t,
  };
}
