// Model tuning — the knobs Cameron turns from the admin console.
// Every scoring engine and every AI prompt reads its numbers and notes from here,
// so a weight change in /admin/model reshapes the whole product without a deploy.

const DEFAULTS = {
  weights: {
    severity: { critical: 18, warning: 8, opportunity: 3 },
    // Per-category multipliers (1 = neutral). Scale how much a category's findings
    // punish the score AND how loudly the AI brief prioritizes them.
    categories: {
      paid: {
        conversion_tracking: 1.4, search_term_waste: 1.2, match_type: 1,
        smart_bidding: 1, pmax: 1, negatives: 1, budget_pacing: 1,
        structure: 1, quality_score: 0.9, ad_copy: 0.8,
      },
      organic: {
        // foundation
        indexability: 1.4, titles: 1, content_depth: 1.2, architecture: 1.1,
        competition: 1, canonicals: 0.9, media: 0.6, page_weight: 0.7,
        // AI readiness
        entity: 1.1, capsule: 1, specificity: 0.8,
        // demand (Search Console)
        striking_distance: 1.2, ctr_gap: 1.1, page_two: 0.9, coverage: 1, brand_mix: 0.5,
      },
    },
    thresholds: {
      // paid
      smart_bidding_min_conv_30d: 30,
      waste_min_clicks: 5,
      waste_share_critical: 0.15,
      waste_share_warning: 0.07,
      broad_share_flag: 0.4,
      // organic
      thin_content_words: 300,
      title_max_len: 62,
      title_min_len: 25,
      page_weight_bytes: 2500000,
      striking_distance_min_pos: 4,
      striking_distance_max_pos: 15,
      target_position: 3,
      value_per_click_default: 4,
      // overlap
      organic_top_position: 3,
      overlap_reclaim_factor: 0.65,
    },
  },
  notes: { global: '', categories: {} },
};

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = (base && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

// Effective settings for an org: DEFAULTS <- global row <- org override row.
async function loadModelSettings(db, orgId) {
  const { data: rows } = await db.from('model_settings')
    .select('*')
    .or(orgId ? `scope.eq.global,org_id.eq.${orgId}` : 'scope.eq.global');
  const global = (rows || []).find((r) => r.scope === 'global');
  const org = (rows || []).find((r) => r.scope === 'org');
  let s = { weights: DEFAULTS.weights, notes: DEFAULTS.notes, version: 1 };
  if (global) s = { weights: deepMerge(s.weights, global.weights), notes: deepMerge(s.notes, global.notes), version: global.version || 1 };
  if (org) s = { weights: deepMerge(s.weights, org.weights), notes: deepMerge(s.notes, org.notes), version: s.version };
  return s;
}

module.exports = { DEFAULTS, deepMerge, loadModelSettings };
