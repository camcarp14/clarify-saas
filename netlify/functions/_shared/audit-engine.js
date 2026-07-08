// Clarify audit engine — deterministic rules, no LLM in the numbers path.
// CONTRACT: every finding builds `evidence` FIRST ({window, formula, inputs, result}),
// then the plain-English summary interpolates ONLY evidence values. Narrative cannot drift from math.
// Thresholds and scoring weights come from model settings (admin-tunable); the
// constants below are the shipped defaults, kept so existing callers never break.

const SMART_BIDDING_MIN_CONV_30D = 30; // default; tunable via model settings

const usd = (micros) => `$${(Number(micros || 0) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const usdN = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const pct = (x) => `${Math.round(Number(x || 0) * 100)}%`;

// ---------- shape the synced rows into one account object ----------
function buildAccount({ snapshots, keywords, terms, structure }) {
  const byCampaign = {};
  for (const s of snapshots) {
    const c = (byCampaign[s.campaign_id] ||= {
      id: s.campaign_id, name: s.campaign_name, channel: s.channel_type,
      status: s.campaign_status, bidding: s.bidding_strategy, budget_micros: 0,
      cost: 0, clicks: 0, conversions: 0, days: {},
    });
    c.budget_micros = Math.max(c.budget_micros, Number(s.budget_micros || 0));
    c.cost += Number(s.cost_micros || 0);
    c.clicks += Number(s.clicks || 0);
    c.conversions += Number(s.conversions || 0);
    c.days[s.snapshot_date] = { cost: Number(s.cost_micros || 0), conv: Number(s.conversions || 0), impr: Number(s.impressions || 0) };
    if (s.search_budget_lost_is != null) c.budget_lost_is = Math.max(c.budget_lost_is || 0, Number(s.search_budget_lost_is));
  }
  const campaigns = Object.values(byCampaign).filter((c) => c.status === 'ENABLED' || c.cost > 0);
  const totals = campaigns.reduce((t, c) => ({
    cost: t.cost + c.cost, clicks: t.clicks + c.clicks, conversions: t.conversions + c.conversions,
  }), { cost: 0, clicks: 0, conversions: 0 });

  // window sums by recency for tracking-breakage checks
  const dates = [...new Set(snapshots.map((s) => s.snapshot_date))].sort();
  const sumWindow = (n) => {
    const win = dates.slice(-n);
    let cost = 0, conv = 0;
    for (const s of snapshots) if (win.includes(s.snapshot_date)) { cost += Number(s.cost_micros || 0); conv += Number(s.conversions || 0); }
    return { cost, conv, days: win.length };
  };

  return { campaigns, totals, keywords, terms, structure: structure || {}, dates, sumWindow };
}

// ---------- rules (each returns a finding or null) ----------

function ruleConversionTracking(a) {
  const w14 = a.sumWindow(14);
  const evidence = {
    window: 'Last 14 days',
    formula: 'flag if spend_14d ≥ $100 AND clicks_14d ≥ 30 AND conversions_14d = 0',
    inputs: { spend_14d: usd(w14.cost), clicks_14d: a.totals.clicks, conversions_14d: w14.conv },
    result: { tracking_looks_broken: w14.cost >= 100e6 && w14.conv === 0 },
  };
  if (evidence.result.tracking_looks_broken) {
    return f('conversion_tracking', 'critical', 'Your conversion tracking looks broken',
      `You spent ${evidence.inputs.spend_14d} in the last 14 days and recorded zero conversions. Either nothing is working — unlikely — or Google can't see your results. Every automated decision in the account is flying blind until this is fixed.`,
      'Verify the Google tag / conversion actions fire on your booking or lead form. This is the single highest-priority fix in the account.', evidence);
  }
  return f('conversion_tracking', 'pass', 'Conversion tracking is recording results',
    `Google recorded ${Math.round(w14.conv)} conversions in the last 14 days against ${evidence.inputs.spend_14d} of spend, so tracking appears to be alive.`, null, evidence);
}

function ruleSearchTermWaste(a) {
  const qualifying = a.terms.filter((x) => Number(x.clicks) >= a.t.wasteMinClicks && Number(x.conversions) === 0);
  const wasted = qualifying.reduce((s, t) => s + Number(t.cost_micros || 0), 0);
  const searchSpend = a.terms.reduce((s, t) => s + Number(t.cost_micros || 0), 0) || 1;
  const share = wasted / searchSpend;
  const top = qualifying.sort((x, y) => y.cost_micros - x.cost_micros).slice(0, 10)
    .map((t) => ({ term: t.term, cost: usd(t.cost_micros), clicks: t.clicks }));
  const evidence = {
    window: 'Last 30 days',
    formula: `wasted = Σ cost of search terms with clicks ≥ ${a.t.wasteMinClicks} AND conversions = 0; share = wasted ÷ total search-term spend`,
    inputs: { qualifying_terms: qualifying.length, total_search_term_spend: usd(searchSpend) },
    result: { wasted_spend: usd(wasted), share_of_spend: pct(share), top_offenders: top },
  };
  const sev = share > a.t.wasteCritical ? 'critical' : share > a.t.wasteWarning ? 'warning' : wasted > 0 ? 'opportunity' : 'pass';
  return f('search_term_waste', sev, sev === 'pass' ? 'Search spend is landing on searches that convert' : `${evidence.result.wasted_spend} went to searches that never convert`,
    sev === 'pass'
      ? `We didn't find meaningful spend on repeat-click, zero-conversion searches in the last 30 days.`
      : `${evidence.result.wasted_spend} of your last 30 days of search spend (${evidence.result.share_of_spend}) went to ${qualifying.length} searches that people clicked repeatedly without a single one converting. That's money buying clicks, not customers.`,
    sev === 'pass' ? null : 'Add the top offenders as negative keywords. This is usually the fastest real savings in any account.', evidence);
}

function ruleMatchType(a) {
  const kwSpend = a.keywords.reduce((s, k) => s + Number(k.cost_micros || 0), 0) || 1;
  const broadSpend = a.keywords.filter((k) => k.match_type === 'BROAD').reduce((s, k) => s + Number(k.cost_micros || 0), 0);
  const broadShare = broadSpend / kwSpend;
  const negs = (a.structure.negatives_campaign || 0) + (a.structure.negatives_adgroup || 0);
  const smartWithData = a.campaigns.some((c) =>
    ['TARGET_CPA', 'TARGET_ROAS', 'MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE'].includes(c.bidding) &&
    c.conversions >= a.t.smartBiddingMin);
  const evidence = {
    window: 'Last 30 days',
    formula: `risk if broad-match spend share > ${Math.round(a.t.broadFlag * 100)}% AND (negatives < 50 OR no Smart Bidding campaign with ≥ ${a.t.smartBiddingMin} conversions/30d)`,
    inputs: { broad_match_spend: usd(broadSpend), broad_share: pct(broadShare), negative_keywords: negs, smart_bidding_with_sufficient_data: smartWithData },
    result: { broad_match_risk: broadShare > a.t.broadFlag && (negs < 50 || !smartWithData) },
  };
  if (evidence.result.broad_match_risk) {
    return f('match_type', 'critical', 'Broad match is running without a safety net',
      `${evidence.inputs.broad_share} of your keyword spend (${evidence.inputs.broad_match_spend}) is on broad match, with only ${negs} negative keywords${smartWithData ? '' : ' and no automated bidding backed by enough conversion data'}. Broad match without tight automated bidding and strong negative hygiene isn't a strategy — it's handing Google a blank check.`,
      'Either tighten to phrase/exact on the biggest spenders, or keep broad only where Smart Bidding has real conversion volume — and build the negative list either way.', evidence);
  }
  if (broadShare > a.t.broadFlag) {
    return f('match_type', 'warning', 'Heavy broad match — watch it closely',
      `${evidence.inputs.broad_share} of keyword spend is broad match. Your negative list (${negs}) and conversion-fed bidding are currently the only things keeping it honest. That's workable, but it needs weekly search-term review, not trust.`,
      'Keep a weekly cadence on the search-terms report while broad share stays this high.', evidence);
  }
  return f('match_type', 'pass', 'Match type mix looks controlled',
    `Broad match is ${evidence.inputs.broad_share} of keyword spend with ${negs} negatives in place — within a range you can actually supervise.`, null, evidence);
}

function ruleSmartBiddingPrematurity(a) {
  const flagged = a.campaigns.filter((c) =>
    ['TARGET_CPA', 'TARGET_ROAS'].includes(c.bidding) && c.conversions < a.t.smartBiddingMin && c.cost > 0)
    .map((c) => ({ campaign: c.name, strategy: c.bidding, conversions_30d: Math.round(c.conversions), spend: usd(c.cost) }));
  const evidence = {
    window: 'Last 30 days',
    formula: `flag campaigns on Target CPA/ROAS with < ${a.t.smartBiddingMin} conversions in 30 days`,
    inputs: { threshold: a.t.smartBiddingMin, campaigns_checked: a.campaigns.length },
    result: { premature_smart_bidding: flagged },
  };
  if (flagged.length) {
    return f('smart_bidding', 'warning', `${flagged.length} campaign${flagged.length > 1 ? 's are' : ' is'} asking the algorithm to learn from too little data`,
      `${flagged.map((x) => `"${x.campaign}"`).join(', ')} ${flagged.length > 1 ? 'are' : 'is'} on ${flagged[0].strategy.replace('_', ' ')} with under ${a.t.smartBiddingMin} conversions a month. Smart Bidding isn't magic — below that volume it's guessing with your money.`,
      'Consolidate conversion volume (merge campaigns or broaden the conversion action) before trusting Target CPA/ROAS, or switch to Maximize Clicks / manual while volume builds.', evidence);
  }
  return f('smart_bidding', 'pass', 'Smart Bidding has enough data where it\'s used',
    `No campaign is running Target CPA/ROAS below the ${a.t.smartBiddingMin}-conversion monthly threshold.`, null, evidence);
}

function rulePmax(a) {
  const pmax = a.campaigns.filter((c) => c.channel === 'PERFORMANCE_MAX');
  if (!pmax.length) return f('pmax', 'pass', 'No Performance Max campaigns to babysit',
    'This account has no PMax campaigns, so there\'s no black-box spend to monitor.', null,
    { window: 'Last 30 days', formula: 'presence check', inputs: { pmax_campaigns: 0 }, result: { pmax_present: false } });

  const pmaxCost = pmax.reduce((s, c) => s + c.cost, 0);
  const share = pmaxCost / (a.totals.cost || 1);
  const starving = pmax.filter((c) => c.conversions < a.t.smartBiddingMin)
    .map((c) => ({ campaign: c.name, conversions_30d: Math.round(c.conversions), spend: usd(c.cost) }));

  // brand cannibalization signal: brand search impressions down while PMax spend up (first vs second half of window)
  const brandCamps = a.campaigns.filter((c) => c.channel === 'SEARCH' && /brand/i.test(c.name || ''));
  let cannibal = null;
  if (brandCamps.length) {
    const half = Math.floor(a.dates.length / 2);
    const sumHalf = (camp, datesArr) => datesArr.reduce((s, d) => s + (camp.days[d]?.impr || 0), 0);
    const sumCostHalf = (camp, datesArr) => datesArr.reduce((s, d) => s + (camp.days[d]?.cost || 0), 0);
    const firstD = a.dates.slice(0, half), lastD = a.dates.slice(half);
    const brandImprFirst = brandCamps.reduce((s, c) => s + sumHalf(c, firstD), 0);
    const brandImprLast = brandCamps.reduce((s, c) => s + sumHalf(c, lastD), 0);
    const pmaxCostFirst = pmax.reduce((s, c) => s + sumCostHalf(c, firstD), 0);
    const pmaxCostLast = pmax.reduce((s, c) => s + sumCostHalf(c, lastD), 0);
    cannibal = {
      brand_impressions_change: brandImprFirst ? (brandImprLast - brandImprFirst) / brandImprFirst : 0,
      pmax_spend_change: pmaxCostFirst ? (pmaxCostLast - pmaxCostFirst) / pmaxCostFirst : 0,
    };
  }
  const cannibalFlag = cannibal && cannibal.brand_impressions_change < -0.25 && cannibal.pmax_spend_change > 0.15;

  const evidence = {
    window: 'Last 30 days (halves compared for trend)',
    formula: `starvation: PMax campaign with < ${a.t.smartBiddingMin} conv/30d. Cannibalization signal: brand search impressions down >25% while PMax spend up >15%. Note: the API does not expose whether brand exclusions are applied — verify in the UI.`,
    inputs: { pmax_campaigns: pmax.length, pmax_spend: usd(pmaxCost), pmax_share_of_spend: pct(share), brand_campaigns_detected: brandCamps.length, trend: cannibal },
    result: { data_starved: starving, cannibalization_signal: !!cannibalFlag },
  };
  if (cannibalFlag) {
    return f('pmax', 'critical', 'PMax looks like it\'s eating your brand traffic',
      `Your brand search impressions dropped ${pct(Math.abs(cannibal.brand_impressions_change))} in the back half of the month while PMax spend rose ${pct(cannibal.pmax_spend_change)}. That pattern usually means PMax is buying searches your brand campaign would have won cheaper — you're paying a premium for customers who were already looking for you.`,
      'Apply brand exclusions to every PMax campaign and re-check this trend in two weeks.', evidence);
  }
  if (starving.length) {
    return f('pmax', 'warning', 'PMax is running on starvation-level data',
      `${starving.map((s) => `"${s.campaign}"`).join(', ')} converted fewer than ${a.t.smartBiddingMin} times in 30 days. PMax with thin conversion data doesn't optimize — it wanders. It's ${evidence.inputs.pmax_share_of_spend} of your total spend right now.`,
      'Consolidate asset groups, feed it a higher-volume conversion action, or cap its budget until it has data to learn from. And confirm brand exclusions are applied — the API can\'t verify that for you.', evidence);
  }
  return f('pmax', 'opportunity', 'PMax is fed — keep it fenced',
    `PMax is ${evidence.inputs.pmax_share_of_spend} of spend with adequate conversion volume. It still deserves a monthly check on brand exclusions and placement reports; "set and forget" is how it drifts.`,
    'Monthly: verify brand exclusions and review placement/asset-group signals.', evidence);
}

function ruleNegatives(a) {
  const negs = (a.structure.negatives_campaign || 0) + (a.structure.negatives_adgroup || 0);
  const lists = a.structure.shared_neg_lists || 0;
  const monthlySpend = a.totals.cost;
  const evidence = {
    window: 'Current account state',
    formula: 'flag if total negatives < 20 while spend ≥ $1,000/30d; opportunity if no shared negative lists',
    inputs: { negatives_total: negs, shared_negative_lists: lists, spend_30d: usd(monthlySpend) },
    result: { thin_negatives: negs < 20 && monthlySpend >= 1000e6, no_shared_lists: lists === 0 },
  };
  if (evidence.result.thin_negatives) {
    return f('negatives', 'warning', 'Your negative keyword list is nearly empty',
      `${negs} negative keywords across an account spending ${evidence.inputs.spend_30d} a month means almost nothing is filtering out bad searches. Negatives are the cheapest lever in paid search and this account barely uses them.`,
      'Start with the wasted-spend list from this audit — every term there is a negative candidate.', evidence);
  }
  if (evidence.result.no_shared_lists) {
    return f('negatives', 'opportunity', 'No shared negative lists',
      `You have ${negs} negatives but no shared lists, so every new campaign starts unprotected. A shared list makes your hygiene reusable.`,
      'Create one shared list of universal negatives (jobs, free, DIY, competitors you don\'t want) and attach it to all campaigns.', evidence);
  }
  return f('negatives', 'pass', 'Negative keyword hygiene looks real',
    `${negs} negatives and ${lists} shared list${lists === 1 ? '' : 's'} — the filtering layer exists.`, null, evidence);
}

function ruleBudgetPacing(a) {
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const monthKey = now.toISOString().slice(0, 7);
  let mtd = 0;
  for (const c of a.campaigns) for (const [d, v] of Object.entries(c.days)) if (d.startsWith(monthKey)) mtd += v.cost;
  const dailyBudget = a.campaigns.filter((c) => c.status === 'ENABLED').reduce((s, c) => s + c.budget_micros, 0);
  const expected = dailyBudget * dayOfMonth;
  const paceRatio = expected ? mtd / expected : 1;
  const projected = dailyBudget ? (mtd / dayOfMonth) * daysInMonth : 0;
  const limited = a.campaigns.filter((c) => (c.budget_lost_is || 0) > 0.1)
    .map((c) => ({ campaign: c.name, impressions_lost_to_budget: pct(c.budget_lost_is) }));
  const evidence = {
    window: `Month to date (day ${dayOfMonth} of ${daysInMonth})`,
    formula: 'pace = MTD spend ÷ (Σ enabled daily budgets × days elapsed); projected = (MTD ÷ days elapsed) × days in month; limited = campaigns losing >10% impressions to budget',
    inputs: { mtd_spend: usd(mtd), sum_daily_budgets: usd(dailyBudget), days_elapsed: dayOfMonth },
    result: { pace_ratio: Math.round(paceRatio * 100) / 100, projected_month_spend: usd(projected), budget_limited_campaigns: limited },
  };
  if (paceRatio > 1.2) {
    return f('budget_pacing', 'warning', 'Spending faster than your budgets say you should',
      `Month to date you've spent ${evidence.inputs.mtd_spend} — ${pct(paceRatio - 1)} above what your daily budgets imply by day ${dayOfMonth}. At this pace the month lands around ${evidence.result.projected_month_spend}. Google is allowed to overspend daily budgets; it's your job to notice.`,
      'Decide whether the overage is buying results or just buying spend, then trim daily budgets or add negatives accordingly.', evidence);
  }
  if (paceRatio < 0.7 && dailyBudget > 0) {
    return f('budget_pacing', 'opportunity', 'You\'re leaving budgeted spend on the table',
      `Spend is running ${pct(1 - paceRatio)} behind your budgets — around ${evidence.result.projected_month_spend} projected for the month. If those budgets reflect real demand you want, something (bids, approvals, targeting) is throttling delivery.`,
      'Check for disapproved ads, low bids on winners, or overly tight targeting before assuming demand isn\'t there.', evidence);
  }
  if (limited.length) {
    return f('budget_pacing', 'opportunity', 'Winning campaigns are hitting their budget ceiling',
      `${limited.map((l) => `"${l.campaign}"`).join(', ')} ${limited.length > 1 ? 'are' : 'is'} losing over 10% of available impressions purely to budget caps. If these convert profitably, the cap is the only thing between you and more customers.`,
      'Shift budget from underperformers into the capped winners.', evidence);
  }
  return f('budget_pacing', 'pass', 'Spend is on pace',
    `MTD spend of ${evidence.inputs.mtd_spend} is tracking with your daily budgets (pace ${evidence.result.pace_ratio}×).`, null, evidence);
}

function ruleStructure(a) {
  const kwByAdGroup = {};
  for (const k of a.keywords) if (k.kw_status === 'ENABLED') (kwByAdGroup[k.ad_group_id] ||= []).push(k);
  const bloated = Object.entries(kwByAdGroup).filter(([, ks]) => ks.length > 20)
    .map(([id, ks]) => ({ ad_group: ks[0].ad_group_name || id, keywords: ks.length }));
  const rsaByAdGroup = a.structure.rsa_by_adgroup || {};
  const searchAdGroups = Object.keys(kwByAdGroup).length;
  const noRsa = Object.keys(kwByAdGroup).filter((id) => !(rsaByAdGroup[id] > 0)).length;
  const evidence = {
    window: 'Current account state',
    formula: 'bloated = ad groups with > 20 enabled keywords; no_rsa = keyword-bearing ad groups with zero enabled RSAs',
    inputs: { ad_groups_with_keywords: searchAdGroups },
    result: { bloated_ad_groups: bloated.slice(0, 10), ad_groups_without_rsa: noRsa },
  };
  if (noRsa > 0) {
    return f('structure', 'critical', `${noRsa} ad group${noRsa > 1 ? 's have' : ' has'} keywords but no ad to show`,
      `${noRsa} of your ${searchAdGroups} keyword ad groups have no enabled responsive search ad. Keywords without ads are paying rent on an empty storefront.`,
      'Add at least one RSA to every active ad group — or pause the ad groups that no longer earn one.', evidence);
  }
  if (bloated.length) {
    return f('structure', 'warning', 'Some ad groups are keyword junk drawers',
      `${bloated.length} ad group${bloated.length > 1 ? 's hold' : ' holds'} more than 20 keywords (worst: "${bloated[0].ad_group}" with ${bloated[0].keywords}). When one ad has to speak for that many intents, it speaks for none of them — relevance and Quality Score both pay.`,
      'Split by intent theme so each ad group\'s ad can actually match what people searched.', evidence);
  }
  return f('structure', 'pass', 'Structure is coherent',
    `Every keyword ad group has an ad, and none has drifted past 20 keywords.`, null, evidence);
}

function ruleQualityScore(a) {
  const scored = a.keywords.filter((k) => k.quality_score != null && Number(k.cost_micros) > 0);
  const spendOnScored = scored.reduce((s, k) => s + Number(k.cost_micros), 0) || 1;
  const weighted = scored.reduce((s, k) => s + Number(k.quality_score) * Number(k.cost_micros), 0) / spendOnScored;
  const drag = scored.filter((k) => Number(k.quality_score) <= 4 && Number(k.cost_micros) >= 50e6)
    .sort((x, y) => y.cost_micros - x.cost_micros).slice(0, 10)
    .map((k) => ({ keyword: k.keyword_text, qs: Number(k.quality_score), spend: usd(k.cost_micros) }));
  const dragSpend = scored.filter((k) => Number(k.quality_score) <= 4).reduce((s, k) => s + Number(k.cost_micros), 0);
  const dragShare = dragSpend / spendOnScored;
  const evidence = {
    window: 'Last 30 days',
    formula: 'weighted QS = Σ(QS × spend) ÷ Σ spend; drag = spend on keywords with QS ≤ 4',
    inputs: { keywords_with_qs: scored.length, spend_weighted_qs: Math.round(weighted * 10) / 10 },
    result: { low_qs_spend: usd(dragSpend), low_qs_share: pct(dragShare), worst_offenders: drag },
  };
  const sev = dragShare > 0.25 ? 'warning' : dragShare > 0.1 ? 'opportunity' : 'pass';
  return f('quality_score', sev,
    sev === 'pass' ? 'Quality Score isn\'t taxing you' : `${evidence.result.low_qs_share} of spend is paying the low-Quality-Score tax`,
    sev === 'pass'
      ? `Spend-weighted Quality Score is ${evidence.inputs.spend_weighted_qs}/10 with minimal spend stuck on QS ≤ 4 keywords.`
      : `${evidence.result.low_qs_spend} (${evidence.result.low_qs_share}) of your keyword spend sits on keywords Google rates 4/10 or worse. Low QS means you pay more per click than a competitor for the same spot — a tax you can fix with relevance.`,
    sev === 'pass' ? null : 'Fix ad-to-keyword relevance and landing page match on the worst offenders, or cut them.', evidence);
}

function ruleAdCopy(a) {
  const strengths = a.structure.ad_strength_counts || {};
  const total = Object.values(strengths).reduce((s, n) => s + n, 0);
  const weak = (strengths.POOR || 0) + (strengths.AVERAGE || 0);
  const share = total ? weak / total : 0;
  const evidence = {
    window: 'Current enabled RSAs',
    formula: 'weak share = (Poor + Average ad strength) ÷ all enabled RSAs',
    inputs: { enabled_rsas: total, strength_breakdown: strengths },
    result: { weak_rsa_share: pct(share) },
  };
  if (total === 0) return null;
  const sev = share > 0.6 ? 'warning' : share > 0.3 ? 'opportunity' : 'pass';
  return f('ad_copy', sev,
    sev === 'pass' ? 'Ad strength is holding up' : `${evidence.result.weak_rsa_share} of your ads are rated Poor or Average`,
    sev === 'pass'
      ? `Most of your ${total} responsive search ads rate Good or Excellent — Google has enough asset variety to work with.`
      : `${weak} of ${total} enabled RSAs are rated Poor or Average. Ad strength is a blunt metric, but at this share it usually means thin headlines and repeated messaging — which caps how often Google shows you.`,
    sev === 'pass' ? null : 'Add distinct headlines/descriptions per intent theme; pin only what compliance truly requires.', evidence);
}

// ---------- assembly ----------
function f(category, severity, title, summary, recommendation, evidence) {
  return { category, severity, title, summary, recommendation, evidence };
}

const SEVERITY_WEIGHT = { critical: 18, warning: 8, opportunity: 3, pass: 0 };

function runAudit(data, weights) {
  const sevW = { ...SEVERITY_WEIGHT, ...(weights?.severity || {}) };
  const catW = weights?.categories?.paid || {};
  const t = weights?.thresholds || {};
  const a = buildAccount(data);
  a.t = {
    smartBiddingMin: t.smart_bidding_min_conv_30d ?? SMART_BIDDING_MIN_CONV_30D,
    wasteMinClicks: t.waste_min_clicks ?? 5,
    wasteCritical: t.waste_share_critical ?? 0.15,
    wasteWarning: t.waste_share_warning ?? 0.07,
    broadFlag: t.broad_share_flag ?? 0.4,
  };
  const findings = [
    ruleConversionTracking(a), ruleSearchTermWaste(a), ruleMatchType(a),
    ruleSmartBiddingPrematurity(a), rulePmax(a), ruleNegatives(a),
    ruleBudgetPacing(a), ruleStructure(a), ruleQualityScore(a), ruleAdCopy(a),
  ].filter(Boolean);
  const penalty = findings.reduce((s, x) => s + (sevW[x.severity] || 0) * (catW[x.category] ?? 1), 0);
  const score = Math.max(5, Math.round(100 - penalty));
  const order = { critical: 0, warning: 1, opportunity: 2, pass: 3 };
  findings.sort((x, y) => order[x.severity] - order[y.severity]);
  findings.forEach((x, i) => (x.sort_order = i));
  return { score, findings, totals: a.totals };
}

module.exports = { runAudit, buildAccount, SMART_BIDDING_MIN_CONV_30D };
