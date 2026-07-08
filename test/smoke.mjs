// Savant smoke test — a synthetic 8-page site with planted problems + fake GSC rows.
// Proves the whole pipeline: parse → model → diagnose → demand → forge → sprint.
// Run: npm run smoke
import { parsePage } from '../src/engine/parse.js';
import { analyze } from '../src/engine/index.js';
import { forgeTitles, forgeSchema, forgeLinks, forgeBrief } from '../src/engine/forge.js';
import { packSprint, sprintMarkdown } from '../src/engine/sprint.js';

const ORIGIN = 'https://acmehvac.com';
const page = (path, html) => {
  const p = parsePage(`${ORIGIN}${path === '/' ? '' : path}`.replace(/\/$/, '') || ORIGIN, html, ORIGIN);
  p.status_code = 200;
  return p;
};
const link = (href, text) => `<a href="${href}">${text}</a>`;
const words = (n, seed) => Array.from({ length: n }, (_, i) => `${seed}${i % 9} furnace heating comfort chicago repair`).join(' ');

const pages = [
  page('/', `<html><head><title>Acme Heating & Cooling | Chicago HVAC</title><meta name="description" content="Chicago's honest HVAC company."></head>
    <body><h1>Chicago Heating & Cooling</h1><p>Fast, documented HVAC work across Chicago. Call (312) 555-0142. 4816 N Damen Avenue, Chicago.</p>
    ${link('/services/furnace-repair', 'Furnace Repair')} ${link('/services/ac-installation', 'AC Installation')} ${link('/about', 'About')} ${link('/blog/furnace-noises', 'Furnace noises explained')}
    <p>${words(80, 'home')}</p></body></html>`),
  page('/services/furnace-repair', `<html><head><title>Furnace Repair</title></head>
    <body><h1>Furnace Repair in Chicago</h1><p>We fix furnaces.</p>${link('/', 'Home')}</body></html>`), // thin + weak capsule + short title
  page('/services/ac-installation', `<html><head><title>AC Installation Chicago | Acme Heating & Cooling — fast quotes and honest prices every time</title><meta name="description" content="AC installs."></head>
    <body><h1>AC Installation in Chicago</h1><h2>How much does AC installation cost in Chicago?</h2><p>From $4,800 installed. ${words(120, 'ac')}</p>${link('/', 'Home')}</body></html>`), // long title, has price + question
  page('/services/duct-cleaning', `<html><head><title>Duct Cleaning</title></head>
    <body><h1>Duct Cleaning</h1><p>${words(60, 'duct')}</p></body></html>`), // ORPHAN money page (nothing links to it) + thin-ish
  page('/services/furnace-repair-chicago', `<html><head><title>Chicago Furnace Repair</title></head>
    <body><h1>Furnace Repair Chicago</h1><p>${words(70, 'fr2')}</p>${link('/', 'Home')}</body></html>`), // competes with /services/furnace-repair
  page('/blog/furnace-noises', `<html><head><title>Why Is My Furnace Making Noise? | Acme</title></head>
    <body><h1>Why is my furnace making a banging noise?</h1><p>${words(150, 'blog')} furnace repair options.</p>${link('/services/furnace-repair', 'furnace repair')}</body></html>`),
  page('/about', `<html><head><title>About Acme | Chicago HVAC Since 1998</title></head>
    <body><h1>About Acme</h1><p>Family-run since 1998. ${words(90, 'about')}</p>${link('/', 'Home')}</body></html>`),
];
// a dead page discovered but failing
pages.push({ url: `${ORIGIN}/services/old-boilers`, path: '/services/old-boilers', status_code: 404, failed: true, outlinks: [], schema_types: [], questions: [], h2s: [], phones: [], images: 0, images_missing_alt: 0, word_count: 0, h1_count: 0, title_length: 0, role: 'money' });

// homepage links to duct-cleaning? deliberately NOT — orphan test. But sitemap found it (simulated by presence).

const queries = [
  { query: 'furnace repair chicago', clicks: 42, impressions: 2600, ctr: 0.016, position: 6.2 },   // striking distance
  { query: 'emergency furnace repair', clicks: 8, impressions: 900, ctr: 0.009, position: 8.8 },   // striking distance
  { query: 'ac installation chicago', clicks: 30, impressions: 1400, ctr: 0.021, position: 4.5 },  // striking distance
  { query: 'furnace tune up cost', clicks: 2, impressions: 700, ctr: 0.003, position: 3.1 },       // CTR gap (pos 3 should get ~10%)
  { query: 'heat pump installation chicago', clicks: 1, impressions: 800, ctr: 0.001, position: 18.4 }, // page two + uncovered
  { query: 'boiler replacement chicago', clicks: 3, impressions: 650, ctr: 0.004, position: 22.0 },     // page two + uncovered
  { query: 'mini split install cost', clicks: 0, impressions: 400, ctr: 0, position: 19.0 },            // page two + uncovered
  { query: 'acme heating', clicks: 210, impressions: 500, ctr: 0.42, position: 1.1 },                   // brand
  { query: 'acme heating and cooling chicago', clicks: 95, impressions: 220, ctr: 0.43, position: 1.0 },// brand
];

const result = analyze({ pages, queries, opts: { valuePerClick: 12, brandName: 'Acme Heating & Cooling' } });

const titles = result.findings.map((f) => `[${f.pillar}/${f.severity}] ${f.category}: ${f.title}`);
console.log('SCORES', result.scores);
console.log('DEMAND META', result.demandMeta);
console.log('FINDINGS:'); titles.forEach((t) => console.log(' ', t));

const must = (cond, label) => { if (!cond) { console.error('FAIL:', label); process.exitCode = 1; } else console.log('ok:', label); };
const cats = new Set(result.findings.map((f) => `${f.pillar}:${f.category}`));
must(result.scores.composite > 0 && result.scores.composite < 100, 'composite score in range');
must(cats.has('foundation:content_depth'), 'thin money pages flagged');
must(cats.has('foundation:architecture'), 'orphan money page flagged');
must(cats.has('foundation:competition'), 'internal competition flagged');
must(cats.has('foundation:indexability'), 'broken page flagged');
must(cats.has('demand:striking_distance'), 'striking distance found');
must(cats.has('demand:ctr_gap'), 'CTR gap found');
must(cats.has('demand:coverage'), 'uncovered queries found');
must(cats.has('demand:brand_mix'), 'brand dependence found');
must(cats.has('ai:entity'), 'AI entity gap found');
const sd = result.findings.find((f) => f.category === 'striking_distance');
must(/\$\d/.test(sd.title), 'striking distance is priced in dollars');

// forge every artifact type
const model = result.model;
const t1 = forgeTitles(model, [`${ORIGIN}/services/furnace-repair`], { brandName: 'Acme Heating & Cooling' });
console.log('\nTITLE FORGE:', JSON.stringify(t1[0].after));
must(t1[0].after.length <= 62 && t1[0].after.title.length >= 15, 'forged title sized right');
const sch = forgeSchema(model, { brandName: 'Acme Heating & Cooling' });
must(sch.local.jsonld['@type'] === 'LocalBusiness' && sch.local.jsonld.telephone.includes('312'), 'LocalBusiness schema with detected phone');
must(sch.faq.length >= 2 && sch.faq[0].jsonld.mainEntity.length >= 2, 'FAQ schema generated');
const links = forgeLinks(model, [`${ORIGIN}/services/duct-cleaning`]);
must(links.length && links[0].placements.length >= 1, 'link placements for orphan');
console.log('LINK PLAN:', links[0].placements.map((p) => p.instruction).join(' | '));
const brief = forgeBrief(model, { query: 'heat pump installation chicago' }, { relatedQueries: ['heat pump vs furnace', 'heat pump cost chicago'] });
must(brief.outline.h2s.length >= 4 && /heat pump/i.test(brief.outline.h1), 'content brief generated for uncovered query');

// sprint packing
const packed = packSprint(result.tasks, 4);
console.log(`\nSPRINT (${packed.hours_used}h / ${packed.hours_budget}h):`);
packed.sprint.forEach((t, i) => console.log(` ${i + 1}. [${t.effort}] ${t.title}${t.value_month ? ` · $${t.value_month}/mo` : ''}`));
must(packed.sprint.length >= 3, 'sprint packs multiple tasks into 4h');
must(packed.hours_used <= 4, 'sprint respects the hours budget');
console.log('\n--- markdown export head ---\n' + sprintMarkdown(packed, ORIGIN).split('\n').slice(0, 8).join('\n'));
console.log(process.exitCode ? '\nSMOKE: FAILURES ABOVE' : '\nSMOKE: ALL GREEN');
