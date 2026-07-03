// Background function (15-min budget): full sync + alert evaluation for ONE connection.
// Invoked by sync-scheduler (fan-out) or right after a connection is finalized.
const { admin, decrypt, sendEmail } = require('./_shared/util');
const { refreshAccessToken, gaql, Q } = require('./_shared/google-ads');

exports.handler = async (event) => {
  if ((event.headers['x-internal-secret'] || '') !== process.env.INTERNAL_SYNC_SECRET)
    return { statusCode: 401, body: 'nope' };
  const { connection_id } = JSON.parse(event.body || '{}');
  const db = admin();
  const { data: conn } = await db.from('google_ads_connections').select('*').eq('id', connection_id).single();
  if (!conn || conn.status !== 'active') return { statusCode: 200, body: 'skipped' };

  try {
    const token = await refreshAccessToken(decrypt(conn.refresh_token_ciphertext));
    const cid = conn.customer_id;

    const [camps, kws, terms, negC, negA, lists, ads] = await Promise.all([
      gaql(token, cid, Q.campaignsDaily),
      gaql(token, cid, Q.keywords),
      gaql(token, cid, Q.searchTerms),
      gaql(token, cid, Q.campaignNegatives),
      gaql(token, cid, Q.adGroupNegatives),
      gaql(token, cid, Q.sharedNegLists),
      gaql(token, cid, Q.ads),
    ]);

    // ---- campaigns -> daily snapshots (upsert) ----
    const snapRows = camps.map((r) => ({
      org_id: conn.org_id, connection_id: conn.id,
      snapshot_date: r.segments.date,
      campaign_id: String(r.campaign.id),
      campaign_name: r.campaign.name,
      channel_type: r.campaign.advertisingChannelType,
      campaign_status: r.campaign.status,
      bidding_strategy: r.campaign.biddingStrategyType,
      budget_micros: Number(r.campaignBudget?.amountMicros || 0),
      cost_micros: Number(r.metrics?.costMicros || 0),
      clicks: Number(r.metrics?.clicks || 0),
      impressions: Number(r.metrics?.impressions || 0),
      conversions: Number(r.metrics?.conversions || 0),
      conversions_value: Number(r.metrics?.conversionsValue || 0),
      search_impression_share: numOrNull(r.metrics?.searchImpressionShare),
      search_budget_lost_is: numOrNull(r.metrics?.searchBudgetLostImpressionShare),
    }));
    for (const chunk of chunks(snapRows, 500))
      await must(db.from('metrics_snapshots').upsert(chunk, { onConflict: 'connection_id,snapshot_date,campaign_id' }));

    // ---- keywords (refresh: delete + insert 30d aggregates) ----
    await must(db.from('keyword_stats').delete().eq('connection_id', conn.id));
    const kwRows = kws.map((r) => ({
      org_id: conn.org_id, connection_id: conn.id,
      campaign_id: String(r.campaign.id), campaign_name: r.campaign.name,
      ad_group_id: String(r.adGroup.id), ad_group_name: r.adGroup.name,
      keyword_text: r.adGroupCriterion?.keyword?.text,
      match_type: r.adGroupCriterion?.keyword?.matchType,
      kw_status: r.adGroupCriterion?.status,
      quality_score: r.adGroupCriterion?.qualityInfo?.qualityScore ?? null,
      cost_micros: Number(r.metrics?.costMicros || 0),
      clicks: Number(r.metrics?.clicks || 0),
      conversions: Number(r.metrics?.conversions || 0),
    }));
    for (const chunk of chunks(kwRows, 500)) await must(db.from('keyword_stats').insert(chunk));

    // ---- search terms ----
    await must(db.from('search_term_stats').delete().eq('connection_id', conn.id));
    const termRows = terms.map((r) => ({
      org_id: conn.org_id, connection_id: conn.id,
      campaign_id: String(r.campaign.id), ad_group_id: String(r.adGroup.id),
      term: r.searchTermView?.searchTerm,
      matched_keyword: r.segments?.keyword?.info?.text ?? null,
      cost_micros: Number(r.metrics?.costMicros || 0),
      clicks: Number(r.metrics?.clicks || 0),
      conversions: Number(r.metrics?.conversions || 0),
    }));
    for (const chunk of chunks(termRows, 500)) await must(db.from('search_term_stats').insert(chunk));

    // ---- structure snapshot ----
    const rsaByAdgroup = {}, strengthCounts = {};
    for (const r of ads) {
      if (r.adGroupAd?.ad?.type === 'RESPONSIVE_SEARCH_AD') {
        const ag = String(r.adGroup.id);
        rsaByAdgroup[ag] = (rsaByAdgroup[ag] || 0) + 1;
        const s = r.adGroupAd.adStrength || 'UNSPECIFIED';
        strengthCounts[s] = (strengthCounts[s] || 0) + 1;
      }
    }
    const structure = {
      negatives_campaign: negC.length,
      negatives_adgroup: negA.length,
      shared_neg_lists: lists.length,
      rsa_by_adgroup: rsaByAdgroup,
      ad_strength_counts: strengthCounts,
    };
    await must(db.from('account_snapshots').delete().eq('connection_id', conn.id));
    await must(db.from('account_snapshots').insert({ org_id: conn.org_id, connection_id: conn.id, structure }));

    await db.from('google_ads_connections')
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq('id', conn.id);

    await evaluateAlerts(db, conn, { snapshots: snapRows, structure });
    return { statusCode: 200, body: 'synced' };
  } catch (err) {
    await db.from('google_ads_connections')
      .update({ status: 'error', last_sync_error: String(err).slice(0, 500) }).eq('id', conn.id);
    return { statusCode: 200, body: 'error recorded' };
  }
};

// ---------- alert evaluation (same evidence-first contract as the audit engine) ----------
async function evaluateAlerts(db, conn, { snapshots, structure }) {
  const { data: rules } = await db.from('alert_rules').select('*')
    .eq('connection_id', conn.id).eq('enabled', true);
  if (!rules?.length) return;

  const dates = [...new Set(snapshots.map((s) => s.snapshot_date))].sort();
  const win = (n) => {
    const w = dates.slice(-n); let cost = 0, conv = 0;
    for (const s of snapshots) if (w.includes(s.snapshot_date)) { cost += s.cost_micros; conv += s.conversions; }
    return { cost, conv };
  };
  const usd = (m) => `$${(m / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const candidates = [];

  for (const rule of rules) {
    const cfg = rule.config || {};
    if (rule.rule_type === 'budget_pace') {
      const day = new Date().getUTCDate();
      const monthKey = new Date().toISOString().slice(0, 7);
      const mtd = snapshots.filter((s) => s.snapshot_date.startsWith(monthKey)).reduce((s, x) => s + x.cost_micros, 0);
      const latestByCampaign = {};
      for (const s of snapshots) if (!latestByCampaign[s.campaign_id] || s.snapshot_date > latestByCampaign[s.campaign_id].snapshot_date) latestByCampaign[s.campaign_id] = s;
      const daily = Object.values(latestByCampaign).filter((s) => s.campaign_status === 'ENABLED').reduce((s, x) => s + x.budget_micros, 0);
      const pace = daily ? mtd / (daily * day) : 1;
      if (pace > (cfg.max_pace || 1.2)) candidates.push({
        rule_type: 'budget_pace', severity: 'warning',
        title: 'Spend is pacing over budget',
        body: `Month-to-date spend is ${usd(mtd)}, ${Math.round((pace - 1) * 100)}% above what your daily budgets imply by day ${day}.`,
        evidence: { formula: 'pace = MTD ÷ (Σ daily budgets × day of month)', inputs: { mtd: usd(mtd), daily_budgets: usd(daily), day }, result: { pace: Math.round(pace * 100) / 100 } },
      });
    }
    if (rule.rule_type === 'cpa_spike') {
      const w7 = win(7), w28 = win(28);
      const cpa7 = w7.conv ? w7.cost / w7.conv : null;
      const cpa28 = w28.conv ? w28.cost / w28.conv : null;
      if (cpa7 && cpa28 && w28.conv >= (cfg.min_conversions || 5) && cpa7 > cpa28 * (cfg.multiplier || 1.5))
        candidates.push({
          rule_type: 'cpa_spike', severity: 'warning',
          title: 'Cost per conversion just spiked',
          body: `You're paying ${usd(cpa7)} per conversion this week vs a ${usd(cpa28)} 28-day norm — a ${Math.round((cpa7 / cpa28 - 1) * 100)}% jump.`,
          evidence: { formula: 'alert if CPA(7d) > multiplier × CPA(28d)', inputs: { cpa_7d: usd(cpa7), cpa_28d: usd(cpa28), multiplier: cfg.multiplier || 1.5 }, result: { ratio: Math.round((cpa7 / cpa28) * 100) / 100 } },
        });
    }
    if (rule.rule_type === 'conversion_tracking') {
      const w3 = win(3), w28 = win(28);
      if (w3.cost >= (cfg.min_spend_3d || 50) * 1e6 && w3.conv === 0 && w28.conv - w3.conv >= (cfg.min_prior_conv_28d || 10))
        candidates.push({
          rule_type: 'conversion_tracking', severity: 'critical',
          title: 'Conversions flatlined — tracking may have broken',
          body: `${usd(w3.cost)} spent over the last 3 days with zero conversions, in an account that normally converts. Check your tag before anything else.`,
          evidence: { formula: 'alert if spend(3d) ≥ threshold AND conv(3d) = 0 AND prior 28d conversions ≥ threshold', inputs: { spend_3d: usd(w3.cost), conv_3d: 0, prior_conv: Math.round(w28.conv) }, result: { likely_breakage: true } },
        });
    }
    if (rule.rule_type === 'pmax_brand') {
      const pmaxIds = new Set(snapshots.filter((s) => s.channel_type === 'PERFORMANCE_MAX').map((s) => s.campaign_id));
      const brandIds = new Set(snapshots.filter((s) => s.channel_type === 'SEARCH' && /brand/i.test(s.campaign_name || '')).map((s) => s.campaign_id));
      if (pmaxIds.size && brandIds.size) {
        const half = Math.floor(dates.length / 2);
        const sum = (ids, ds, field) => snapshots.filter((s) => ids.has(s.campaign_id) && ds.includes(s.snapshot_date)).reduce((s2, x) => s2 + Number(x[field] || 0), 0);
        const bImpr1 = sum(brandIds, dates.slice(0, half), 'impressions'), bImpr2 = sum(brandIds, dates.slice(half), 'impressions');
        const pCost1 = sum(pmaxIds, dates.slice(0, half), 'cost_micros'), pCost2 = sum(pmaxIds, dates.slice(half), 'cost_micros');
        const drop = bImpr1 ? (bImpr2 - bImpr1) / bImpr1 : 0, rise = pCost1 ? (pCost2 - pCost1) / pCost1 : 0;
        if (drop < -(cfg.impr_drop || 0.25) && rise > (cfg.pmax_rise || 0.15))
          candidates.push({
            rule_type: 'pmax_brand', severity: 'critical',
            title: 'PMax may be cannibalizing your brand search',
            body: `Brand search impressions fell ${Math.round(Math.abs(drop) * 100)}% while PMax spend rose ${Math.round(rise * 100)}% over the same window. Verify brand exclusions on PMax.`,
            evidence: { formula: 'alert if brand impressions Δ < -25% AND PMax spend Δ > +15% (window halves)', inputs: { brand_impr_change: Math.round(drop * 100) / 100, pmax_spend_change: Math.round(rise * 100) / 100 }, result: { cannibalization_signal: true } },
          });
      }
    }
  }

  // dedupe: one alert per rule_type per 24h per connection
  for (const c of candidates) {
    const { data: recent } = await db.from('alerts').select('id')
      .eq('connection_id', conn.id).eq('rule_type', c.rule_type)
      .gte('triggered_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()).limit(1);
    if (recent?.length) continue;
    const { data: alert } = await db.from('alerts')
      .insert({ ...c, org_id: conn.org_id, connection_id: conn.id }).select().single();
    if (!alert) continue;
    const { data: owner } = await db.from('profiles').select('email')
      .eq('org_id', conn.org_id).eq('role', 'owner').limit(1).single();
    if (owner?.email) {
      const r = await sendEmail({
        to: owner.email,
        subject: `[Clarify] ${c.title}`,
        html: `<div style="font-family:sans-serif;max-width:520px"><h2 style="margin:0 0 8px">${c.title}</h2><p>${c.body}</p><p style="color:#667"><em>${c.evidence.formula}</em></p><p><a href="${process.env.APP_URL}/alerts">Open Clarify →</a></p></div>`,
      });
      if (r.ok) await db.from('alerts').update({ emailed_at: new Date().toISOString() }).eq('id', alert.id);
    }
  }
}

function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
function numOrNull(v) { return v == null ? null : Number(v); }
async function must(p) { const { error } = await p; if (error) throw new Error(error.message); }
