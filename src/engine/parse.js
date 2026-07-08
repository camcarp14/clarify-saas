// Savant page parser — isomorphic (browser + Node), dependency-free.
// One page in, one structured record out. Everything downstream — the money map,
// the diagnosis, the fix forge — reads ONLY from this shape, so integrating into
// the Clarify SaaS later means swapping the fetch layer, nothing else.

export const MONEY_HINTS = /\/(services?|pricing|plans|book|booking|schedule|quote|estimate|contact|locations?|products?|shop|repair|install|installation|replacement|treatment|menu|areas?)\b/i;
const SERVICE_WORDS = /\b(repair|install|installation|replacement|service|services|cleaning|removal|maintenance|emergency|inspection|tune[- ]?up|quote|estimate|pricing|near me)\b/i;

export const strip = (html) => String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&[a-z#0-9]+;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const matchAll = (html, re) => {
  const out = []; let m;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(html))) out.push(m);
  return out;
};

export function classifyPage(path, title, h1) {
  const p = String(path || '/').toLowerCase();
  if (p === '/') return 'home';
  if (MONEY_HINTS.test(p) || SERVICE_WORDS.test(`${title || ''} ${h1 || ''}`)) return 'money';
  if (/\/(blog|news|articles?|resources?|guides?|learn|faq|tips)\b/.test(p)) return 'content';
  if (/\/(about|team|reviews?|testimonials?|gallery|portfolio|careers?)\b/.test(p)) return 'trust';
  if (/\/(privacy|terms|sitemap|login|cart|account|search)\b/.test(p)) return 'utility';
  return 'other';
}

export function parsePage(url, html, siteOrigin) {
  const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : null; };

  const h1s = matchAll(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).map((m) => strip(m[1])).filter(Boolean);
  const h2s = matchAll(html, /<h([23])[^>]*>([\s\S]*?)<\/h\1>/i).map((m) => strip(m[2])).filter(Boolean).slice(0, 40);
  const imgs = matchAll(html, /<img\b[^>]*>/i);
  const missingAlt = imgs.filter((m) => !/\balt\s*=\s*("[^"]*[^"\s][^"]*"|'[^']*[^'\s][^']*')/i.test(m[0])).length;

  const internal = new Set();
  for (const m of matchAll(html, /<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/i)) {
    try {
      const u = new URL(m[1], url);
      if (u.origin === siteOrigin && !/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|css|js|xml)$/i.test(u.pathname)) {
        u.hash = ''; u.search = '';
        internal.add((u.href.replace(/\/$/, '')) || u.origin);
      }
    } catch { /* malformed href */ }
  }

  const ldBlocks = matchAll(html, /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i).map((m) => m[1]);
  const schemaTypes = new Set();
  for (const block of ldBlocks) {
    for (const m of block.matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)) schemaTypes.add(m[1]);
    for (const m of block.matchAll(/"@type"\s*:\s*\[([^\]]+)\]/g))
      for (const t of m[1].matchAll(/"([A-Za-z]+)"/g)) schemaTypes.add(t[1]);
  }

  const robotsMeta = pick(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/i) || '';
  const text = strip(html);
  const title = pick(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i);
  const h1 = h1s[0] || null;
  let path = '/';
  try { path = new URL(url).pathname || '/'; } catch { /* keep '/' */ }

  const questions = [...h2s, ...h1s].filter((h) =>
    /\?$/.test(h) || /^(how|what|why|when|where|which|can|do|does|should|is|are)\b/i.test(h)).slice(0, 20);

  const phones = [...new Set((text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g) || []))].slice(0, 3);
  const addressHint = /\b\d{1,5}\s+[A-Za-z0-9.\s]{2,30}\b(street|st|avenue|ave|road|rd|blvd|boulevard|drive|dr|lane|ln|suite|ste|court|ct|way)\b/i.test(text);

  return {
    url,
    path,
    title,
    title_length: title ? title.length : 0,
    meta_description: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})/i)
      || pick(/<meta[^>]+content=["']([^"']{1,400})["'][^>]+name=["']description["']/i),
    h1,
    h1_count: h1s.length,
    h2s,
    questions,
    word_count: text.split(' ').filter(Boolean).length,
    first_text: text.slice(0, 340),
    canonical: pick(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i),
    noindex: /noindex/i.test(robotsMeta),
    images: imgs.length,
    images_missing_alt: missingAlt,
    outlinks: [...internal],
    schema_types: [...schemaTypes],
    has_faq_schema: schemaTypes.has('FAQPage') || schemaTypes.has('Question'),
    has_local_schema: [...schemaTypes].some((t) => /LocalBusiness|Dentist|Plumber|Electrician|HVACBusiness|MedicalBusiness|Attorney|Restaurant|Store|AutoRepair|RoofingContractor|HomeAndConstructionBusiness|ProfessionalService/i.test(t)),
    has_org_schema: schemaTypes.has('Organization') || schemaTypes.has('WebSite'),
    phones,
    address_hint: addressHint,
    price_signals: /\$\s?\d/.test(text) || /\b(price|pricing|cost|rates?|fee)s?\b/i.test(`${title || ''} ${h1 || ''}`),
    role: classifyPage(path, title, h1),
    bytes: typeof Buffer !== 'undefined' ? Buffer.byteLength(html, 'utf8') : new Blob([html]).size,
  };
}

// tokenization shared by matching logic everywhere
const STOP = new Set(['the', 'and', 'for', 'with', 'your', 'our', 'you', 'near', 'best', 'top', 'from', 'that', 'this', 'are', 'was', 'has', 'have', 'can', 'how', 'what', 'why', 'when', 'a', 'an', 'of', 'in', 'on', 'to', 'is', 'it', 'at', 'by', 'or', 'we', 'us', 'me']);
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
export const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
export const overlap = (aSet, bSet) => {
  if (!aSet.size || !bSet.size) return 0;
  let hit = 0; for (const w of aSet) if (bSet.has(w)) hit++;
  return hit / Math.min(aSet.size, bSet.size);
};
