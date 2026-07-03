// Thin Google Ads REST client. API version is env-driven because Google sunsets versions ~yearly.
const V = () => process.env.GOOGLE_ADS_API_VERSION || 'v18';
const BASE = () => `https://googleads.googleapis.com/${V()}`;

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

function headers(accessToken, loginCustomerId) {
  const h = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  const mcc = (loginCustomerId || process.env.GOOGLE_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');
  if (mcc) h['login-customer-id'] = mcc;
  return h;
}

// Paginated GAQL search. Returns flat array of result rows.
async function gaql(accessToken, customerId, query) {
  const cid = String(customerId).replace(/-/g, '');
  let pageToken, out = [];
  do {
    const res = await fetch(`${BASE()}/customers/${cid}/googleAds:search`, {
      method: 'POST',
      headers: headers(accessToken),
      body: JSON.stringify({ query, pageToken, pageSize: 5000 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`GAQL error (${res.status}): ${JSON.stringify(data).slice(0, 800)}`);
    out = out.concat(data.results || []);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

async function listAccessibleCustomers(accessToken) {
  const res = await fetch(`${BASE()}/customers:listAccessibleCustomers`, {
    headers: headers(accessToken),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`listAccessibleCustomers failed: ${JSON.stringify(data)}`);
  return (data.resourceNames || []).map((r) => r.split('/')[1]);
}

async function customerName(accessToken, customerId) {
  try {
    const rows = await gaql(accessToken, customerId,
      'SELECT customer.descriptive_name, customer.id FROM customer LIMIT 1');
    return rows[0]?.customer?.descriptiveName || customerId;
  } catch { return customerId; }
}

// ---------- Sync queries (last 30 days) ----------
const Q = {
  campaignsDaily: `
    SELECT segments.date, campaign.id, campaign.name, campaign.status,
           campaign.advertising_channel_type, campaign.bidding_strategy_type,
           campaign_budget.amount_micros,
           metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.conversions, metrics.conversions_value,
           metrics.search_impression_share, metrics.search_budget_lost_impression_share
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS AND campaign.status != 'REMOVED'`,
  keywords: `
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
           ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
           ad_group_criterion.status, ad_group_criterion.quality_info.quality_score,
           metrics.cost_micros, metrics.clicks, metrics.conversions
    FROM keyword_view
    WHERE segments.date DURING LAST_30_DAYS AND ad_group_criterion.status != 'REMOVED'`,
  searchTerms: `
    SELECT campaign.id, ad_group.id, search_term_view.search_term,
           segments.keyword.info.text,
           metrics.cost_micros, metrics.clicks, metrics.conversions
    FROM search_term_view
    WHERE segments.date DURING LAST_30_DAYS`,
  campaignNegatives: `
    SELECT campaign.id FROM campaign_criterion
    WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'`,
  adGroupNegatives: `
    SELECT ad_group.id FROM ad_group_criterion
    WHERE ad_group_criterion.negative = TRUE AND ad_group_criterion.type = 'KEYWORD'`,
  sharedNegLists: `
    SELECT shared_set.id, shared_set.name FROM shared_set
    WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'`,
  ads: `
    SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad_strength
    FROM ad_group_ad
    WHERE ad_group_ad.status = 'ENABLED' AND campaign.status = 'ENABLED'`,
};

module.exports = { refreshAccessToken, gaql, listAccessibleCustomers, customerName, Q };
