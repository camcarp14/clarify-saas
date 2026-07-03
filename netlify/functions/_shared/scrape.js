// Site fingerprinting: title/description, emails on page, socials, tech tells, personalization signals.
// The same instinct as the paid-search audits — find the concrete, specific thing worth mentioning.
async function fingerprint(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClarifyOutreach/1.0)' },
    signal: AbortSignal.timeout(10000),
  });
  const html = (await res.text()).slice(0, 400000);
  const pick = (re) => (html.match(re) || [])[1] || null;

  const emails = [...new Set((html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
    .map((e) => e.toLowerCase())
    .filter((e) => !/\.(png|jpg|jpeg|gif|svg|webp)$/.test(e) && !e.includes('example.') && !e.includes('sentry') && !e.includes('wixpress'))
  )].slice(0, 5);

  const social = (host) => {
    const m = html.match(new RegExp(`https?://(?:www\\.)?${host}/[A-Za-z0-9_./-]+`, 'i'));
    return m ? m[0] : null;
  };
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    site_title: pick(/<title[^>]*>([^<]{1,200})/i),
    site_description: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})/i)
      || pick(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i),
    emails_found: emails,
    socials: {
      linkedin: social('linkedin\\.com'), instagram: social('instagram\\.com'),
      facebook: social('facebook\\.com'), x: social('x\\.com') || social('twitter\\.com'),
    },
    tech: {
      wordpress: /wp-content|wp-includes/i.test(html),
      shopify: /cdn\.shopify|myshopify/i.test(html),
      wix: /wix\.com|wixstatic/i.test(html),
      squarespace: /squarespace/i.test(html),
      ga4: /gtag\(|googletagmanager/i.test(html),
      meta_pixel: /fbq\(|facebook\.net\/tr/i.test(html),
      calendly: /calendly\.com/i.test(html),
    },
    signals: {
      has_booking: /book (now|online|an appointment)|schedule (a|your)|calendly/i.test(html),
      has_form: /<form/i.test(html),
      copyright_year: Number(pick(/(?:©|&copy;|copyright)\s*(\d{4})/i)) || null,
      headline: pick(/<h1[^>]*>([^<]{5,140})/i),
    },
    content_excerpt: text.slice(0, 1500),
  };
}
module.exports = { fingerprint };
