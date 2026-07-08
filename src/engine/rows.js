// organic_pages row <-> engine page. One mapper, three consumers:
// the crawl function (write), the re-audit function (read), and the Playbook UI (read).
export function pageToRow(p, { org_id, property_id }) {
  return {
    org_id, property_id,
    url: p.url, path: p.path || null, status_code: p.status_code || null,
    is_money_page: p.role === 'money',
    role: p.role || 'other',
    title: p.title || null, meta_description: p.meta_description || null,
    h1: p.h1 || null, h1_count: p.h1_count || 0, h2s: p.h2s || [],
    questions: p.questions || [], first_text: p.first_text || null,
    word_count: p.word_count || 0, canonical: p.canonical || null, noindex: !!p.noindex,
    images: p.images || 0, images_missing_alt: p.images_missing_alt || 0,
    internal_links: (p.outlinks || []).length, inbound_internal_links: 0,
    outlinks: (p.outlinks || []).slice(0, 200),
    schema_types: p.schema_types || [], has_faq_schema: !!p.has_faq_schema,
    has_local_schema: !!p.has_local_schema, has_org_schema: !!p.has_org_schema,
    phones: p.phones || [], address_hint: !!p.address_hint, price_signals: !!p.price_signals,
    bytes: p.bytes || 0,
  };
}
export function rowToPage(r) {
  const path = r.path || (() => { try { return new URL(r.url).pathname; } catch { return '/'; } })();
  return {
    url: r.url, path, status_code: r.status_code,
    failed: !r.status_code || r.status_code >= 400,
    title: r.title, title_length: r.title ? r.title.length : 0,
    meta_description: r.meta_description, h1: r.h1, h1_count: r.h1_count || 0,
    h2s: r.h2s || [], questions: r.questions || [], first_text: r.first_text || '',
    word_count: r.word_count || 0, canonical: r.canonical, noindex: !!r.noindex,
    images: r.images || 0, images_missing_alt: r.images_missing_alt || 0,
    outlinks: r.outlinks || [], schema_types: r.schema_types || [],
    has_faq_schema: !!r.has_faq_schema, has_local_schema: !!r.has_local_schema,
    has_org_schema: !!r.has_org_schema, phones: r.phones || [],
    address_hint: !!r.address_hint, price_signals: !!r.price_signals,
    role: r.role || (r.is_money_page ? 'money' : (path === '/' ? 'home' : 'other')),
    bytes: r.bytes || 0,
  };
}
