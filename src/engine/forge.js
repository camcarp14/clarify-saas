// The Fix Forge — where findings become paste-ready artifacts.
// Deterministic on purpose: every artifact is generated from the site's own data,
// works with zero API keys, and is safe to hand a client verbatim. The optional
// AI endpoint only *expands* these (drafting prose); it never replaces them.

import { linkSources } from './model.js';
import { tokens } from './parse.js';

const cap = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
const short = (u) => { try { const p = new URL(u).pathname; return p.length > 1 ? p : '/'; } catch { return u; } };

function guessCity(model) {
  // best-effort: a Capitalized token that appears across titles/h1s and isn't a service word
  const counts = {};
  for (const p of model.pages) {
    for (const m of `${p.title || ''} ${p.h1 || ''}`.matchAll(/\b([A-Z][a-z]{3,})\b/g)) {
      const w = m[1];
      if (/(Service|Repair|Install|Company|Quality|Expert|Local|Home|Free|Best|About|Contact)/.test(w)) continue;
      counts[w] = (counts[w] || 0) + 1;
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 2 ? top[0] : null;
}

function topicOf(page) {
  const t = [...(page.fingerprint || tokens(`${page.title || ''} ${page.h1 || ''}`))];
  return cap(t.slice(0, 3).join(' ')) || cap(short(page.url).replace(/[/-]/g, ' ').trim()) || 'This Service';
}

// ---------- titles & metas ----------
export function forgeTitles(model, targetUrls, opts = {}) {
  const city = opts.city || guessCity(model);
  const brand = opts.brandName || (model.home?.title || '').split(/[|\-–]/)[0].trim() || 'Your Brand';
  const targets = model.pages.filter((p) => targetUrls.includes(p.url));
  return targets.map((p) => {
    let topic = topicOf(p);
    if (city) topic = topic.replace(new RegExp(`\\b${city}\\b`, 'ig'), '').replace(/\s+/g, ' ').trim() || topic;
    const base = city ? `${topic} in ${city}` : topic;
    let title = `${base} | ${brand}`;
    if (title.length > 62) title = `${base} | ${brand.split(' ')[0]}`;
    if (title.length > 62) title = base.slice(0, 62);
    const perks = [p.price_signals && 'transparent pricing', 'fast scheduling', 'work you can see documented'].filter(Boolean).join(', ');
    const meta = `${topic}${city ? ` in ${city}` : ''} — ${perks}. ${p.questions[0] ? `${p.questions[0].replace(/\?$/, '')}? Answered on this page.` : 'Get a straight answer and a real quote.'}`.slice(0, 155);
    return {
      kind: 'title',
      page: short(p.url), url: p.url,
      before: { title: p.title || '(none)', length: p.title_length },
      after: { title, length: title.length, meta_description: meta },
      note: !city ? 'City not detected — swap in the service area for local pull.' : null,
    };
  });
}

// ---------- schema ----------
export function forgeSchema(model, opts = {}) {
  const home = model.home;
  const city = opts.city || guessCity(model);
  const phone = model.pages.flatMap((p) => p.phones)[0] || 'PHONE';
  const name = opts.brandName || (home?.title || '').split(/[|\-–]/)[0].trim() || 'BUSINESS NAME';
  const local = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name,
    url: home?.url || 'https://example.com',
    telephone: phone,
    address: { '@type': 'PostalAddress', streetAddress: 'STREET ADDRESS', addressLocality: city || 'CITY', addressRegion: 'STATE', postalCode: 'ZIP' },
    areaServed: city || 'SERVICE AREA',
    openingHours: 'Mo-Fr 08:00-18:00',
  };
  const faqPer = model.money.slice(0, 6).map((p) => {
    const qs = (p.questions.length ? p.questions : [
      `How much does ${topicOf(p).toLowerCase()} cost${city ? ` in ${city}` : ''}?`,
      `How fast can you schedule ${topicOf(p).toLowerCase()}?`,
    ]).slice(0, 4);
    return {
      page: short(p.url), url: p.url,
      jsonld: {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: qs.map((q) => ({
          '@type': 'Question', name: q.endsWith('?') ? q : `${q}?`,
          acceptedAnswer: { '@type': 'Answer', text: 'ANSWER IN 2–3 SPECIFIC SENTENCES (include a number, a timeframe, or a price).' },
        })),
      },
    };
  });
  return {
    kind: 'schema',
    local: { placement: 'Every page, in <head> — most CMSs have a "header scripts" box.', jsonld: local, fill_in: ['STREET ADDRESS', 'STATE', 'ZIP', phone === 'PHONE' ? 'PHONE' : null].filter(Boolean) },
    faq: faqPer,
    note: 'Answers marked ALL-CAPS are the only blanks — everything else was read off the site.',
  };
}

// ---------- internal links ----------
export function forgeLinks(model, targetUrls) {
  const targets = model.pages.filter((p) => targetUrls.includes(p.url));
  return targets.map((tPage) => ({
    kind: 'links',
    target: short(tPage.url), url: tPage.url,
    placements: linkSources(model, tPage, 3).map((s) => ({
      on_page: short(s.page.url),
      link_text: s.anchor,
      instruction: `On ${short(s.page.url)}, link the phrase "${s.anchor}" (or the closest natural mention) to ${short(tPage.url)}.`,
    })),
  })).filter((x) => x.placements.length);
}

// ---------- content briefs ----------
export function forgeBrief(model, { url, query }, opts = {}) {
  const city = opts.city || guessCity(model);
  const page = url ? model.pages.find((p) => p.url === url) : null;
  const topic = query ? cap(query) : page ? topicOf(page) : 'Target Topic';
  const related = query
    ? (opts.relatedQueries || []).filter((q) => q !== query).slice(0, 5)
    : (page?.questions || []).slice(0, 5);
  const target = page ? Math.max(700, (page.word_count || 0) + 400) : 900;
  const internalIn = page ? linkSources(model, page, 3).map((s) => short(s.page.url)) : [];
  return {
    kind: 'brief',
    for: page ? short(page.url) : `NEW PAGE → /${(query || 'topic').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    url: page?.url || null,
    query: query || null,
    outline: {
      h1: city ? `${topic} in ${city}` : topic,
      opening: `2–3 sentences that answer the search directly: what it is, who it's for${city ? `, that you serve ${city}` : ''}, and a from-$ price or timeframe. This is the block AI answers quote.`,
      h2s: [
        `What's included in ${topic.toLowerCase()}`,
        `${topic} cost${city ? ` in ${city}` : ''}: what drives the price`,
        'How the process works (with real timelines)',
        ...related.map((r) => (String(r).endsWith('?') ? r : `${cap(String(r))}?`)),
        `Why choose us for ${topic.toLowerCase()}`,
      ].slice(0, 7),
      proof: 'One named review or before/after photo per major section — specificity is what earns both rankings and citations.',
      faq_block: 'Mark the question H2s up with the FAQ schema from the Forge.',
      word_target: target,
      internal_links_in: internalIn,
      internal_links_out: model.money.filter((p) => p.url !== page?.url).slice(0, 2).map((p) => short(p.url)),
    },
  };
}

// ---------- redirect lines ----------
export function forgeRedirects(failedPages) {
  return {
    kind: 'redirects',
    lines: failedPages.slice(0, 10).map((p) => `Redirect 301 ${short(p.url)} /  # ${p.status_code || 'unreachable'} — point at the closest live equivalent instead of / where one exists`),
    note: 'Apache format shown; Netlify equivalent: "/old-path  /new-path  301" in _redirects.',
  };
}
