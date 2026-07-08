// Savant diagnosis — foundation + AI-answer readiness.
// Same contract as every Clarify engine: evidence FIRST ({window, formula, inputs,
// result}), narrative interpolates only evidence values. Each finding also names
// its fix: { forge: <artifact kind>, targets: [urls] } so the UI can jump from
// "here's the problem" to "here's the paste-ready fix" in one tap.

const short = (u) => { try { const p = new URL(u).pathname; return p.length > 1 ? p : '/'; } catch { return u; } };
const f = (category, severity, title, summary, recommendation, evidence, fix) =>
  ({ category, pillar: 'foundation', severity, title, summary, recommendation, evidence, fix });

export function diagnoseFoundation(model, t) {
  const out = [];
  const { pages, money, failed, competition, stats, home } = model;

  // --- indexability ---
  const blocked = pages.filter((p) => p.noindex && (p.role === 'money' || p.role === 'home'));
  if (blocked.length || failed.length) {
    out.push(f('indexability', blocked.length ? 'critical' : 'warning',
      blocked.length ? `${blocked.length} money page${blocked.length > 1 ? 's are' : ' is'} hidden from Google` : `${failed.length} page${failed.length > 1 ? 's' : ''} failed during the crawl`,
      blocked.length
        ? `${blocked.map((p) => short(p.url)).join(', ')} carr${blocked.length > 1 ? 'y' : 'ies'} a noindex tag. Every ranking these pages could earn is forfeited until it comes off — this outranks every other fix on this report.`
        : `${failed.map((p) => `${short(p.url)} (${p.status_code || 'unreachable'})`).slice(0, 5).join(', ')} returned errors. Broken linked pages bleed authority and strand crawlers.`,
      blocked.length ? 'Remove the noindex directive (usually an SEO-plugin toggle), then request indexing in Search Console.' : 'Fix or 301 the failing URLs and update the links that point at them.',
      { window: 'This crawl', formula: 'money/home pages with noindex; pages returning ≥400',
        inputs: { pages_checked: stats.crawled },
        result: { noindexed: blocked.map((p) => short(p.url)), broken: failed.map((p) => ({ page: short(p.url), status: p.status_code || 'unreachable' })).slice(0, 8) } },
      blocked.length ? null : { forge: 'redirects', targets: failed.map((p) => p.url) }));
  } else {
    out.push(f('indexability', 'pass', 'Everything crawled is reachable and indexable',
      `All ${stats.live} live pages returned 200; no money page blocks indexing.`, null,
      { window: 'This crawl', formula: 'money/home noindex + ≥400 checks', inputs: { pages_checked: stats.crawled }, result: { issues: 0 } }, null));
  }

  // --- titles (missing / duplicate / off-length) with fix artifacts ---
  const untitled = pages.filter((p) => !p.title);
  const byTitle = {};
  for (const p of pages) if (p.title) (byTitle[p.title.toLowerCase()] ||= []).push(p);
  const dupes = Object.values(byTitle).filter((g) => g.length > 1);
  const offLen = pages.filter((p) => p.title && (p.title_length > t.title_max_len || p.title_length < t.title_min_len));
  const titleTargets = [...new Set([...untitled, ...dupes.flat(), ...offLen].map((p) => p.url))];
  if (untitled.length || dupes.length) {
    out.push(f('titles', 'warning',
      dupes.length ? `${dupes.length} title${dupes.length > 1 ? 's are' : ' is'} shared across pages` : `${untitled.length} page${untitled.length > 1 ? 's have' : ' has'} no title`,
      `${untitled.length ? `${untitled.length} untitled page${untitled.length > 1 ? 's' : ''}. ` : ''}${dupes.length ? `Duplicate titles (worst: "${dupes[0][0].title.slice(0, 60)}" on ${dupes[0].length} pages) make Google pick one page and bench the rest.` : ''} The title is the strongest relevance signal you fully control — rewrites are drafted in the Fix Forge.`,
      'Ship the drafted titles: one unique, intent-matching line per page.',
      { window: 'This crawl', formula: `missing titles; duplicates; length outside ${t.title_min_len}–${t.title_max_len} chars`,
        inputs: { pages_checked: pages.length },
        result: { missing: untitled.map((p) => short(p.url)).slice(0, 8), duplicate_groups: dupes.slice(0, 5).map((g) => ({ title: g[0].title.slice(0, 60), pages: g.length })), off_length: offLen.length } },
      { forge: 'titles', targets: titleTargets }));
  } else if (offLen.length > pages.length * 0.3) {
    out.push(f('titles', 'opportunity', `${offLen.length} titles are the wrong size for the results page`,
      `Outside ${t.title_min_len}–${t.title_max_len} characters, titles either waste the space or get truncated mid-pitch. Rewrites are drafted in the Fix Forge.`,
      'Ship the drafted titles for the worst offenders.',
      { window: 'This crawl', formula: `titles outside ${t.title_min_len}–${t.title_max_len} chars`, inputs: { pages_checked: pages.length }, result: { off_length: offLen.map((p) => ({ page: short(p.url), length: p.title_length })).slice(0, 8) } },
      { forge: 'titles', targets: offLen.map((p) => p.url) }));
  } else {
    out.push(f('titles', 'pass', 'Titles are unique and sized right', 'Every page introduces itself with its own, properly sized title.', null,
      { window: 'This crawl', formula: 'uniqueness + length window', inputs: { pages_checked: pages.length }, result: { issues: offLen.length } }, null));
  }

  // --- thin money pages ---
  const thin = money.filter((p) => p.word_count < t.thin_content_words).sort((a, b) => a.word_count - b.word_count);
  out.push(thin.length
    ? f('content_depth', thin.length > money.length * 0.5 && money.length >= 2 ? 'critical' : 'warning',
      `${thin.length} money page${thin.length > 1 ? 's are' : ' is'} too thin to compete`,
      `${thin.slice(0, 4).map((p) => `${short(p.url)} (${p.word_count} words)`).join(', ')} — the pages meant to close customers don't say enough to rank or convince. Expansion briefs are drafted in the Fix Forge.`,
      'Build each out with the brief: process, area served, proof, and the questions buyers actually ask.',
      { window: 'This crawl', formula: `money pages under ${t.thin_content_words} words`, inputs: { money_pages: money.length }, result: { thin: thin.map((p) => ({ page: short(p.url), words: p.word_count })).slice(0, 8) } },
      { forge: 'brief', targets: thin.map((p) => p.url) })
    : f('content_depth', 'pass', 'Money pages carry real substance', `Every money page clears ${t.thin_content_words} words of actual content.`, null,
      { window: 'This crawl', formula: `≥ ${t.thin_content_words} words on money pages`, inputs: { money_pages: money.length }, result: { thin: [] } }, null));

  // --- architecture: orphans + buried money ---
  const noGraph = pages.length > 1 && pages.every((p) => !(p.outlinks || []).length);
  if (noGraph) {
    out.push(f('architecture', 'pass', 'Link graph pending a fresh crawl',
      'This crawl predates link-graph capture, so orphan and depth checks are on hold — re-crawl once and they light up.', null,
      { window: 'Stored crawl', formula: 'outlinks captured per page', inputs: { pages_checked: pages.length }, result: { pages_with_outlinks: 0 } }, null));
  }
  const orphans = noGraph ? [] : money.filter((p) => p.inbound === 0);
  const buried = noGraph ? [] : money.filter((p) => p.depth != null && p.depth > 2 && p.inbound > 0);
  if (orphans.length || buried.length) {
    out.push(f('architecture', orphans.length ? 'warning' : 'opportunity',
      orphans.length ? `${orphans.length} money page${orphans.length > 1 ? 's are' : ' is'} orphaned` : `${buried.length} money page${buried.length > 1 ? 's are' : ' is'} buried ${'>'}2 clicks deep`,
      `${orphans.length ? `${orphans.map((p) => short(p.url)).join(', ')} get zero internal links — invisible by architecture. ` : ''}${buried.length ? `${buried.map((p) => short(p.url)).slice(0, 4).join(', ')} sit${buried.length > 1 ? '' : 's'} more than two clicks from the homepage, where authority barely reaches.` : ''} Exact link placements are drafted in the Fix Forge.`,
      'Ship the drafted internal links — cheapest authority you\u2019ll ever move.',
      { window: 'This crawl (within sample)', formula: 'money pages with 0 inbound links; money pages at depth > 2',
        inputs: { money_pages: money.length }, result: { orphaned: orphans.map((p) => short(p.url)), buried: buried.map((p) => ({ page: short(p.url), depth: p.depth })) } },
      { forge: 'links', targets: [...orphans, ...buried].map((p) => p.url) }));
  } else {
    out.push(f('architecture', 'pass', 'Money pages are wired into the site', 'Every money page is linked and within two clicks of home.', null,
      { window: 'This crawl', formula: 'inbound > 0 and depth ≤ 2 on money pages', inputs: { money_pages: money.length }, result: { orphaned: 0, buried: 0 } }, null));
  }

  // --- internal competition ---
  if (competition.length) {
    out.push(f('competition', 'warning', `${competition.length} pair${competition.length > 1 ? 's' : ''} of money pages fight over the same topic`,
      `${competition.slice(0, 3).map((c) => `${c.a} ↔ ${c.b}`).join(' · ')} — near-identical topical fingerprints split relevance signals two ways, and Google resolves ties by ranking neither well.`,
      'Pick one canonical page per topic: merge the copy, 301 the loser, or re-angle one page at a genuinely different intent.',
      { window: 'This crawl', formula: 'money-page pairs with fingerprint overlap ≥ 0.7', inputs: { money_pages: money.length }, result: { pairs: competition.slice(0, 6) } }, null));
  }

  // --- canonicals ---
  const offCanon = pages.filter((p) => {
    if (!p.canonical) return false;
    try { return new URL(p.canonical, p.url).href.replace(/\/$/, '') !== p.url.replace(/\/$/, ''); } catch { return true; }
  });
  if (offCanon.length) {
    out.push(f('canonicals', 'warning', `${offCanon.length} page${offCanon.length > 1 ? 's' : ''} credit${offCanon.length > 1 ? '' : 's'} rankings to a different URL`,
      `${offCanon.slice(0, 5).map((p) => short(p.url)).join(', ')} declare a canonical that isn't the page itself — usually a CMS default quietly telling Google "rank that other page instead."`,
      'Verify each is deliberate; self-referencing canonicals are the safe default.',
      { window: 'This crawl', formula: 'canonical ≠ self', inputs: { pages_checked: pages.length }, result: { off_canonical: offCanon.slice(0, 6).map((p) => ({ page: short(p.url), canonical: p.canonical })) } }, null));
  }

  // --- media hygiene ---
  const totalImgs = pages.reduce((s, p) => s + p.images, 0);
  const missingAlt = pages.reduce((s, p) => s + p.images_missing_alt, 0);
  if (totalImgs >= 10 && missingAlt / totalImgs > 0.5) {
    out.push(f('media', 'opportunity', `${Math.round((missingAlt / totalImgs) * 100)}% of images are invisible to search`,
      `${missingAlt} of ${totalImgs} images ship without alt text — no image-search presence, weaker relevance, and an accessibility miss in one.`,
      'Describe what each image shows; for job photos, include the service and the city.',
      { window: 'This crawl', formula: 'images without alt ÷ all images', inputs: { images: totalImgs }, result: { missing_alt: missingAlt } }, null));
  }

  // --- page weight ---
  const heavy = pages.filter((p) => p.bytes > t.page_weight_bytes);
  if (heavy.length) {
    out.push(f('page_weight', 'opportunity', `${heavy.length} page${heavy.length > 1 ? 's ship' : ' ships'} oversized HTML`,
      `${heavy.slice(0, 4).map((p) => `${short(p.url)} (${(p.bytes / 1e6).toFixed(1)}MB)`).join(', ')} — bloated builder output drags the mobile loads that rankings and patience both punish.`,
      'Trim the theme output and lazy-load below-the-fold media.',
      { window: 'This crawl (HTML payload)', formula: `HTML > ${(t.page_weight_bytes / 1e6).toFixed(1)}MB`, inputs: { pages_checked: pages.length }, result: { heavy: heavy.slice(0, 5).map((p) => ({ page: short(p.url), mb: +(p.bytes / 1e6).toFixed(1) })) } }, null));
  }

  return out.filter(Boolean);
}

// ---------------- AI-answer readiness (the GEO pillar) ----------------
export function diagnoseAiReadiness(model) {
  const out = [];
  const { pages, money, home } = model;
  const g = (category, severity, title, summary, recommendation, evidence, fix) =>
    ({ category, pillar: 'ai', severity, title, summary, recommendation, evidence, fix });

  const anySchema = pages.some((p) => p.schema_types.length);
  const local = pages.some((p) => p.has_local_schema);
  const faqPages = pages.filter((p) => p.has_faq_schema);
  const gaps = [!anySchema && 'no structured data anywhere', !local && 'no LocalBusiness entity', !faqPages.length && 'no FAQ markup'].filter(Boolean);
  if (gaps.length) {
    out.push(g('entity', gaps.length >= 2 ? 'warning' : 'opportunity',
      gaps.length >= 2 ? 'AI answers have nothing solid to cite here' : `One gap to AI citations: ${gaps[0]}`,
      `The crawl found ${gaps.join(', ')}. AI Overviews and assistants cite sources they can parse with confidence — entity markup and question-formatted content are how a business gets *named* in an AI answer instead of a competitor. Ready-to-paste JSON-LD is in the Fix Forge.`,
      'Ship the generated LocalBusiness JSON-LD sitewide and the FAQ schema on money pages.',
      { window: 'This crawl', formula: 'structured data present · LocalBusiness entity · FAQ markup',
        inputs: { pages_checked: pages.length, schema_types_seen: [...new Set(pages.flatMap((p) => p.schema_types))].slice(0, 10) },
        result: { has_structured_data: anySchema, has_local_entity: local, faq_pages: faqPages.length } },
      { forge: 'schema', targets: [home?.url, ...money.map((p) => p.url)].filter(Boolean) }));
  } else {
    out.push(g('entity', 'pass', 'Machine-readable and citation-eligible',
      'Structured data, a local entity, and FAQ markup are all present — the raw material AI answers cite.', null,
      { window: 'This crawl', formula: 'entity + FAQ + structured data checks', inputs: { pages_checked: pages.length }, result: { faq_pages: faqPages.length } }, null));
  }

  // answer capsules: does each money page answer its intent in the first breath?
  const capsuleWeak = money.filter((p) => (p.first_text || '').length < 180 || (!p.questions.length && !p.has_faq_schema));
  if (money.length && capsuleWeak.length) {
    out.push(g('capsule', capsuleWeak.length > money.length * 0.6 ? 'warning' : 'opportunity',
      `${capsuleWeak.length} money page${capsuleWeak.length > 1 ? 's open' : ' opens'} without an extractable answer`,
      `${capsuleWeak.slice(0, 4).map((p) => short(p.url)).join(', ')} — AI systems lift their citations from the first ~300 characters and from question-formatted sections. Pages that open with fluff or a slider get summarized from someone else's site.`,
      'Open each money page with a 2–3 sentence direct answer (what, where, for whom, from what price), and add the real questions buyers ask as H2s.',
      { window: 'This crawl', formula: 'first_text < 180 chars OR no question headings/FAQ on money pages',
        inputs: { money_pages: money.length }, result: { weak_capsules: capsuleWeak.map((p) => short(p.url)).slice(0, 8) } },
      { forge: 'brief', targets: capsuleWeak.map((p) => p.url) }));
  }

  // specificity: numbers, prices, and NAP are what make a source citable
  const nap = pages.some((p) => p.phones.length) && pages.some((p) => p.address_hint);
  const priced = money.filter((p) => p.price_signals).length;
  if (money.length && (!nap || priced === 0)) {
    out.push(g('specificity', 'opportunity', 'Short on the specifics AI answers quote',
      `${!nap ? 'Phone/address signals are thin or inconsistent across pages. ' : ''}${priced === 0 ? 'No money page mentions pricing — "from $X" lines are among the most-quoted fragments in AI answers.' : ''} Vague sites get paraphrased; specific sites get cited.`,
      'Put NAP in the footer of every page and a "from $X" or typical-range line on each money page.',
      { window: 'This crawl', formula: 'phone + address presence; price signals on money pages',
        inputs: { money_pages: money.length }, result: { nap_consistent: nap, money_pages_with_pricing: priced } }, null));
  }

  return out;
}
