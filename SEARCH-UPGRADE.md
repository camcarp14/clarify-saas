# Clarify Search — SaaS Upgrade Notes

The app is now the full search product: paid + organic + the overlap between them, rebranded to match clarifysearch, with AI strategist briefs steered from your admin console. Build verified (`vite build`, 902 modules, clean).

## Deploy checklist (in order)

1. **Run the migration.** `supabase/migrations/005_search.sql` in the Supabase SQL editor. Purely additive — safe on the live DB. Adds: `organic_properties`, `organic_pages`, `gsc_connections`, `gsc_query_stats`, `organic_audits`, `organic_findings`, `model_settings`, `ai_briefs`, all with RLS matching your existing patterns.
2. **Google Cloud Console (same OAuth client, 2 minutes).** Enable the **Search Console API** for the project, and add the `https://www.googleapis.com/auth/webmasters.readonly` scope to the consent screen. The redirect URI is unchanged — the existing `google-oauth-callback` handles both products via a `product=gsc` state flag.
3. **Env vars: no changes.** `ANTHROPIC_API_KEY` (already set for outreach drafting) now also powers briefs; `ANTHROPIC_MODEL` optional override; `INTERNAL_SYNC_SECRET` is reused for the post-connect GSC sync.
4. **Deploy to Netlify** as usual. No new scheduled functions — crawls and syncs are on-demand.
5. **First run:** visit `/admin/model` once and hit Save to write model v1 (optional — engines fall back to shipped defaults until then).

## What's new

**Rebrand.** Full Clarify Search design system: near-black `#0a0b0f`, warm ink, amber = clicks you buy, mint = clicks you earn, Space Grotesk / Instrument Serif / IBM Plex Mono. Two-bar brand mark, bone primary buttons, channel-reactive UI via `data-ch` scoping. Every legacy class kept working — outreach pages retinted for free.

**Organic engine** (`_shared/organic-engine.js`). Dependency-free crawler (sitemap-seeded, money-pages-first, 12-page sample) + 12 evidence-first rules on the same receipt contract as paid: indexability, titles, meta descriptions, headings, content depth, image alt, canonicals, internal links/orphans, **AI-visibility readiness** (LocalBusiness + FAQ schema — the GEO angle), page weight, and two Search-Console-powered rules (striking distance, CTR gap).

**Search Console.** Connect from the Organic tab or Settings → same Google OAuth, read-only scope → auto-matches the GSC property to the crawled site → 28-day query/page stats sync. Switcher + "Sync now" included.

**Overlap engine** (`_shared/overlap-engine.js`). The thesis in code: paid terms × organic queries × crawled pages → *"$X of ad spend is buying clicks you already earn"* with an estimated reclaimable figure, content gaps (paid-proven winners with no page), and organic-only wins to protect. Live-computed on the Audit → Overlap tab.

**AI Strategist Brief** (`ai-brief.js`, Dashboard panel). Reads both audits + the overlap, then writes a cross-channel plan: *The read / This week / Where the money moves / Watchlist*, with **[Paid]/[Organic]/[Both]** tags. Hard-locked to evidence — it cannot invent numbers. Every brief records the model version that shaped it.

**Model tuning — your backend weighting/notes** (`/admin/model`). Severity weights, per-category multipliers for both channels, every rule threshold (smart-bidding minimum, waste flags, thin-content words, reclaim factor…), plus analyst notes (global + per-category) injected into every brief's prompt as standing guidance. One save bumps the model version and recalibrates the whole product on the next run — no deploy.

**Audit page** is now three-tab (Paid / Organic / Overlap) under a persistent dual-ring instrument with an adaptive verdict. **Dashboard** gets the instrument, a "Clicks earned (28d)" card, the amber/mint chart, and the brief panel. The paid audit engine now reads your tunable thresholds/weights (defaults unchanged — existing behavior identical until you touch them).

## Notes
- Crawler is polite: 12 pages max, 4-way concurrency, 9s timeouts; uses your existing background-function pattern with status polling.
- `run-organic-audit` re-scores a stored crawl instantly — use it after changing weights instead of re-crawling.
- Support email and Stripe tiers untouched.

## Third-party review pass (post-build audit)

**Security**
- `model_settings` was readable by any signed-in customer via RLS — your analyst notes and scoring knobs would have been visible to anyone querying the table. Now Clarify-admin-only at both the RLS layer and the `model-settings` GET endpoint. Customers see the effects (scores, briefs, receipts), never the knobs.
- SSRF guard on the crawler: `organic-crawl-background` fetches whatever URL a user types, so it now refuses localhost, `.local`/`.internal`, IPv6 literals, and every private/reserved IPv4 range before any request fires.

**Completeness**
- Built the GSC **property switcher** that the `gsc-sites` endpoint was created for — "Change property" on the Organic tab lists your Search Console properties, switches, re-syncs, and nudges you to Re-score. (Auto-match usually gets it right; now wrong picks are a two-click fix.)
- First-ever crawl had a race where the status poller could fail to attach if the property row wasn't created within 1.2s — now retries for ~9s before surfacing an error.
- Auth page still wore the old wordmark and a paid-only tagline — rebranded to the bars mark with a both-channels line.

**Mobile**
- Admin tuning inputs were 13px mono — iOS zooms any focused input under 16px; bumped to 16px on touch widths.
- Ring caption labels could collide with wrapped rows on narrow screens — instrument row-gap now clears them.
- Channel tabs get nowrap + overflow scroll as a guard on very small screens.

**Hygiene:** package + lockfile renamed to `clarify-search`; removed an unused variable in AdminModel; verified zero legacy-brand strings remain in `src/`. Rebuilt clean after every change (vite, 902 modules).

---

# Release 2 — the Organic Playbook

The organic side is now a full growth system, not just an audit. Customer-facing name: **Playbook** (the savant engine lives under the hood).

**What shipped**
- **A second engine** (`src/engine/` — isomorphic ES modules) replaces the original organic ruleset with a deeper one: foundation (indexability, titles, content depth, architecture/orphans/depth, internal competition, canonicals, media, page weight), **AI readiness** (entity schema, answer capsules, specificity), and **Search-Console demand** — striking distance, CTR shortfalls, page-two demand, uncovered queries, brand-dependence — every demand finding **priced in dollars**.
- **Real-CPC pricing.** Value-per-click derives automatically from the org's own `search_term_stats` (spend ÷ clicks); falls back to a tunable default. Every audit stores its assumptions (`organic_audits.sub`).
- **/playbook** — the new page: tasks ranked by $-at-stake per hour, an hours-budget slider that repacks the sprint live, one-click Markdown export (client-report ready), and **the fix under every task**: rewritten titles/metas (before→after), paste-ready LocalBusiness + FAQ JSON-LD, exact internal-link placements, full content briefs with optional AI drafting (`ai-draft-page`).
- **Audit → Organic tab** gains the four sub-score dials (Foundation / Demand capture / Money pages / AI readiness), the pricing-assumptions strip, a **Money Map** (every page graded A–F: indexed · titled · substantial · linked · answerable, plus internal-competition pairs), and per-finding $-chips + "open the drafted fix" links.
- **AI strategist brief** now reads the Playbook's top tasks (already value-ranked) as evidence.
- **Admin model tuning** gains the new organic taxonomy (16 categories) plus `target position` and `default $/click` thresholds — the CTR money math is now yours to tune.
- Engine ships with its test: `npm run smoke`.

**Deploy additions (on top of Release 1's checklist)**
1. Run `supabase/migrations/006_playbook.sql` (additive; run 005 first if you haven't).
2. No new env vars. `ANTHROPIC_API_KEY` now also powers brief drafting.
3. After deploy, hit **Re-crawl & audit** once per property — legacy crawls lack the link graph and richer page fields, and the Playbook banner will say so until you do.

---

# Release 3 — Holistic Search + the Polish System

**Holistic search**
- **Search → Overview tab** (new default): the whole program on one screen — blended score (paid+organic weighted equally), the **Search Ledger** (clicks bought vs clicks earned, spend vs **earned-media value at your real CPC**), the click-mix bar, and **Term Intelligence**: every meaningful term with both channels side by side and a verdict — *harvest* (ranking top-3, still paying), *defend* (free win, protect it), *fill gap* (paid converts, organic absent), *trim* (spend, no results, no backup). Verdict rules print in the receipt. New function: `search-overview.js` (no migration needed — reads existing tables).
- **Playbook is now the whole program's week**: paid audit findings join the sprint as tasks (dollar values read straight off their evidence — never invented), channel filter (All/Paid/Organic), paid tasks deep-link into the Paid audit. Sprint export header: "Search sprint."

**The polish system** (why tools feel like tools: polish is a *system*, not a feature)
- Motion tokens (`--dur-1/2/3`, ease-out + spring) applied everywhere: page transitions, tab crossfades, staggered section entrances, spring toasts, smooth fix-panel expansion (grid-rows technique — no jank), press physics on every interactive element (scale on :active, lift on hover).
- **Numbers behave like instruments**: every ring counts to its score, every metric card tweens (`useTween`/`Num`), all numerics are tabular so nothing jiggles.
- **Skeletons replace spinners** on every search surface — pages develop instead of arriving.
- **⌘K command palette** — fuzzy jump to any surface, keyboard-first, hint in the rail.
- Toast system for async confirmations; retryable error states; styled scrollbars + selection; `text-wrap: balance` on headings; 42px touch targets + safe-area insets on mobile; `prefers-reduced-motion` disables all of it.

No new migrations, no new env vars in this release.
