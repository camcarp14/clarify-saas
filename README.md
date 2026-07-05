# Clarify Paid Search — SaaS

Multi-tenant Google Ads health platform for small businesses. React + Vite · Supabase (auth/DB/RLS) · Netlify (hosting + functions) · Stripe.

**The product promise, enforced in code:** every number ships with its formula. The audit engine and alert engine build an `evidence` object *first* ({window, formula, inputs, result}); the plain-English summary interpolates only those values. Narrative can never drift from math. No LLM anywhere in the numbers path.

## Repo map

```
supabase/migrations/001_init.sql     schema + RLS + signup trigger + admin helper
netlify/functions/
  _shared/util.js                    service client, JWT auth, AES-256-GCM, signed state, Resend
  _shared/google-ads.js              REST client, paginated GAQL, all sync queries
  _shared/audit-engine.js            10 deterministic rules — the crown jewel
  google-oauth-start|callback        OAuth; 1 account → auto-finalize, many → picker
  google-customers|select-customer   account picker endpoints
  sync-scheduler.js                  every 30 min; fans out per-connection by tier cadence
  sync-connection-background.js      15-min budget: 7 GAQL pulls → Supabase, then alert eval + email
  run-audit.js                       POST → runs engine on synced data
  stripe-create-checkout|portal|webhook
src/                                 app shell, morning-check dashboard, audit report,
                                     alerts, settings/billing, admin book-of-business
```

## Setup

### 1. Supabase
1. New project → SQL editor → run `supabase/migrations/001_init.sql`.
2. Auth → providers → Email. For local dev you may disable "Confirm email"; keep it on in prod (the signup screen already handles the "check your email" state).
3. After signing yourself up: `select private.make_clarify_admin('you@clarifypaidsearch.com');`
4. Copy URL + anon key + service-role key into env.

### 2. Google Cloud + Google Ads
1. Cloud project → OAuth consent screen (External) → scope `https://www.googleapis.com/auth/adwords`.
2. OAuth client (Web) → redirect URI: `https://YOUR-APP/.netlify/functions/google-oauth-callback` **and** `https://YOUR-APP/api/google-oauth-callback`.
3. Developer token: apply from your **Clarify MCC** (Google Ads → Tools → API Center). Reality check: you start with *test-account-only* access; apply for **Basic access** to read client accounts — approval typically takes a few days and wants a working demo + privacy policy. The token's quota is shared across all tenants (that's why the scheduler staggers fan-out).
4. `GOOGLE_LOGIN_CUSTOMER_ID` = your MCC ID, digits only. Clients' accounts don't need to be linked under the MCC for read via their own OAuth grant, but linking is the long-term structure and required for some features.
5. `GOOGLE_ADS_API_VERSION` is env-driven (default v18). Google sunsets versions ~yearly — when a sync starts failing with a version error, bump this one var. Verify the current version at developers.google.com/google-ads/api before launch.

### 3. Stripe
1. Products: Starter $99/mo, Growth $249/mo, Pro $499/mo → put the three `price_...` ids in env.
2. Webhook endpoint: `https://YOUR-APP/api/stripe-webhook` with events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` → copy signing secret.

### 4. Netlify
1. New site from repo. Build: `npm run build`, publish `dist` (netlify.toml already says so).
2. Set every var from `.env.example` (generate the three secrets with `openssl rand -hex 32`).
3. `APP_URL` = the deployed origin. The `sync-scheduler` schedule and `/api/*` redirects are in netlify.toml.

### 5. Resend (alert emails)
Verify your sending domain, set `RESEND_API_KEY` + `ALERT_FROM_EMAIL`. Without a key, alerts still write to the app; emails are skipped gracefully.

## How the pieces behave

- **Sync**: scheduler runs every 30 min but each connection syncs on its tier cadence (starter/growth ~daily, pro hourly). Non-paying orgs with expired trials are skipped. Each connection is an isolated background invocation — one slow account can't block the rest.
- **Alerts**: evaluated at the end of every sync. Four rules (budget pace >1.2×, CPA 7d >1.5× 28d norm, conversion flatline on an account that normally converts, PMax-up/brand-impressions-down). Deduped to one per rule per connection per 24 h; owner gets an email with the formula in it.
- **Audit**: `POST /api/run-audit` runs 10 rules against synced data — conversion tracking, search-term waste, match-type risk (broad without negatives *and* without data-fed Smart Bidding = "blank check"), Smart Bidding under 30 conv/mo, PMax starvation + brand-cannibalization signal, negative hygiene, budget pacing, structure (keyword junk drawers, ad-less ad groups), Quality Score drag, ad strength. Score = 100 − severity-weighted penalties.
- **Tenancy**: RLS on every table via two security-definer helpers. Client writes are limited to acknowledging/resolving and settings; everything else goes through service-role functions. `is_clarify_admin` grants cross-tenant *read* — the Admin page's "View as" is read-only and logs to `audit_log`.
- **Agency-assist seam**: `delegations` table exists; no logic yet. Adding delegated access later is additive, not a migration.

## Outreach module (merged in)

Clarify now bundles two things behind one subscription: the Google Ads audit/alerts product
above, and an outreach module — discover leads across verticals, run multi-channel sequences,
and handle replies inside the app through each customer's own connected inbox.

**One more migration, on the same project:**
```
supabase/migrations/002_outreach.sql
```
Purely additive — new tables plus credits + mailing-address columns on `organizations` — safe to
run on the already-live database from `001_init.sql`. Reuses the existing `organizations`,
`profiles`, `private.user_org_id()`, and `private.is_clarify_admin()` — no second admin system,
no second login. *(If you ran an earlier copy of 002 that lacked `mailing_address`, run
`003_mailing_address_patch.sql` — one line, harmless either way.)*

**Before email sequences can send:** fill in **Settings → Business details → Mailing address.**
It's stamped into every outreach email footer (CAN-SPAM requires it) and the sequence runner
refuses email sends without it — the Settings page warns you until it's set.

**New env vars to add** (on top of everything already set):
```
GOOGLE_PLACES_API_KEY=...         # enable Places API (New) in a Google Cloud project
MS_CLIENT_ID=...                  # Microsoft Entra app registration (Outlook)
MS_CLIENT_SECRET=...
ANTHROPIC_API_KEY=...             # AI-personalized outreach copy (falls back to template if unset)
ANTHROPIC_MODEL=claude-sonnet-4-6
```
Also add two Gmail OAuth redirect URIs to the *same* Google Cloud OAuth client used for Ads
(or a separate Cloud project, either works): `{APP_URL}/api/gmail-oauth-callback`, with scopes
`gmail.send` + `gmail.readonly` added to the consent screen alongside `adwords`.
SMS (Twilio) needs no global config — customers connect their own Twilio account in Settings.

**Billing is bundled, not additive.** The three existing Stripe prices (Starter/Growth/Pro)
now gate both modules together — one upgrade unlocks more ad accounts *and* more mailboxes,
channels, and discovery credits at once. `stripe-webhook.js` resets the outreach credit
allowance on every checkout and plan change; no second webhook, no second set of Stripe prices.
Tier pricing in `src/pages/Settings.jsx` reflects the bundle ($149/$399/$699) — a starting
hypothesis, worth sanity-checking against what you'd actually charge for both together.

**New scheduled function:** `outreach-scheduler` runs every 5 minutes (separate from the
30-minute Ads `sync-scheduler`) — resets expired credit periods, then kicks inbox sync and
the sequence runner. Both schedules are already in `netlify.toml`.

**The unified "Today" page + view controls:** the dashboard is now one morning check for both
modules — a combined "Needs you" queue (unread replies, LinkedIn tasks, unacked alerts, open
findings), then collapsible Paid search and Outreach pipeline sections. A focus toggle
(Everything / Paid search / Outreach) lets either half own the screen; the spend chart has a
14d/30d window; Inbox filters All/Unread; Leads adds source filters and sort; Audit and Alerts
default to open items with an Everything view. Every one of these preferences persists per
browser via localStorage (`src/lib/usePref.js`) — no backend state, nothing to migrate.

**Compliance stance, unchanged from the standalone build:** LinkedIn steps render as drafted
tasks on the Dashboard — copy, open profile, mark sent — nothing automated from Clarify's
infrastructure. SMS cannot send without a consent record on the lead. Every email carries the
org's mailing address and a signed unsubscribe link. Not legal advice; get a lawyer's sign-off
before marketing the SMS channel commercially.

## Deferred on purpose (updated)
SMS/Slack alerts for Ads · metered billing · LLM phrasing layer for audit findings ·
code-splitting the bundle (880 kB pre-gzip now that outreach is in the same app — fine for now,
`manualChunks` when it matters) · fully-automated LinkedIn sending · cold SMS.


## Admin console (internal)

`/admin` — a code-split internal console (customers never download its JS; verify:
`AdminArea-*.js` is a separate chunk in the build). Admins land here at login; "View as"
drops into the customer app read-only and "Exit to admin" returns.

**Pages:** Organizations (searchable/paginated directory + bulk plan/credit actions) ·
Org detail (billing controls, connection re-sync + revoke, on-demand audits, pipeline
snapshot, user management, internal notes, typed-confirmation danger zone) · System
health (stale syncs vs plan cadence, overdue enrollments, Stripe webhook pulse) ·
Billing (MRR by tier, past-due/trial/canceled lists) · Audit trail (every admin write).

**Security model, unchanged on purpose:** admins can READ everything via existing RLS
bypasses but the client can never WRITE another org's rows — every mutation goes through
`admin-org-actions.js` / `admin-stripe.js` (403 unless `is_clarify_admin`, service-role
write, `audit_log` row per action). Run `supabase/migrations/004_admin.sql` (two additive
columns: `suspended_at`, `internal_notes`).

**Two flagged decisions (deliberately not guessed):** removing a user deletes their
`profiles` row only — their `auth.users` login survives but has no workspace; if you want
full deactivation, that's a one-line `auth.admin` call to add. Suspension is enforced at
the app layer (suspension screen at login); a determined user with a saved token could
still hit the REST API read-only until token expiry — Supabase Auth-level banning is the
hardening step if that ever matters.


## Brand re-theme (matched to clarifypaidsearch.com)

The app's design tokens were retargeted from the original light paper-and-teal palette to
the marketing site's dark, blue-to-purple brand — same architecture, same components,
new `:root` values doing almost all of the work (`src/styles.css`):

| Role | Was | Now |
|---|---|---|
| Page background | `#f2f4f3` light mist | `#06070c` near-black |
| Card surface | `#ffffff` | `#0f1119` opaque panel |
| Primary text | `#10201c` dark pine | `#f4f2ea` warm off-white |
| Brand accent | `#0e7c66` teal | `#5b7cff` blue → `#7a5cff` purple gradient |
| Body font | Instrument Sans | Inter |
| Mono font | Spline Sans Mono | IBM Plex Mono |
| Display font | Bricolage Grotesque | *unchanged — already matched* |

Because nearly every component reads color through these variables rather than hardcoding
values, this propagated across the whole app from one edit. Six things the token swap
*couldn't* fix automatically, handled by hand:
- **Hover states** on the nav rail and inbox thread list previously matched hover-to-page-
  background — correct when the page was the lightest surface, backwards now that it's the
  darkest. Both now lighten on hover instead.
- **The primary button** picked up the marketing site's signature blue→purple gradient,
  restrained to a subtler glow than the marketing hero's CTA since this one gets clicked
  dozens of times a session, not once.
- **The admin console's warning strip** used to be `var(--ink)` as a dark bar in an
  otherwise-light app — under the new palette `--ink` is the *light* text color, which
  would've made the strip invisible. It's gold-on-black now, reading as an unmistakable
  caution signal instead of quietly breaking.
- **Three chart-axis label colors** in `Dashboard.jsx` were hardcoded (recharts needs a
  literal color string for SVG fill, not a CSS variable) — updated by hand to match.
- **Three danger-zone accent colors** in `AdminOrgDetail.jsx` were hardcoded to an
  approximate red instead of referencing `--act` — updated to the new red exactly.
- **The login screen** gets the marketing hero's full radial-gradient glow as a brand
  moment; the dense working app (rail + main) stays flat and calm on purpose — a
  multi-hour-a-day interface shouldn't fight a background gradient for attention the way
  a once-per-visit hero section can.

Also swapped: the Google Fonts `<link>` in `index.html` (Inter + IBM Plex Mono in place of
Instrument Sans + Spline Sans Mono — without this the CSS `font-family` names would
silently fall back to system fonts).

## Platform audit pass (customer + admin + connection + mobile)

A deep audit of the whole platform, fixing what it found. Headline fix: **support view
now shows the truth.** Previously, while an admin impersonated a customer, `org` in
AuthContext was still the admin's *own* org — so Settings, the trial banner, and the
credits meter all showed the admin's data, not the customer's. The context now loads the
impersonated tenant's org row and exposes it as the effective org, so every page reads
the right workspace. `refreshOrg` refreshes whichever org is active.

Customer app: added a full **password reset flow** (Forgot password on the sign-in
screen → email link → `/reset` page), which simply didn't exist. Dark-theme fallout
fixed: the chart tooltip was still white-on-white (recharts defaults), and the audit
score ring's empty track was invisible against the dark card.

Admin console: the Stripe invoices card now distinguishes "no invoices" from "couldn't
reach Stripe (not configured or request failed)" instead of silently showing an empty
list either way; the audits/alerts grid collapses properly on narrow screens.

Connection gaps closed: **Discover** (which spends the customer's credits) and
**Onboarding** (where OAuth would bind the admin's own account, not the customer's) are
now blocked in support view with plain-language explanations — every other page was
already gated. The Dashboard's "Connect Google Ads" CTA hides during impersonation too.

Mobile, both apps (shared classes, so one fix covers both): the nav rail becomes an
app-style horizontal-scroll top bar under 820px instead of a multi-row wrap; every wide
table (admin directory, audit trail, users, invoices, leads, sequences, discovery
results) scrolls horizontally inside a `.tablewrap` instead of blowing out the page;
inputs hold 16px on touch widths so iOS stops zooming the viewport on focus; banners and
segmented controls wrap; `theme-color` meta matches the dark chrome.

Honest limits: no live Supabase/Stripe/Google credentials exist in this environment, so
runtime click-through remains the acceptance test — this pass is build-verified,
schema-verified (every risky query column-checked against migrations), and
contract-verified (every `api()` call has a matching function file). Google Ads is
knowingly not yet connected; all Ads-dependent surfaces have graceful empty states.

## Mobile fix pass (from real device screenshots)

Two real bugs, found by actually looking at phone screenshots rather than assuming the
mobile CSS layer from the audit pass was sufficient:

**The gap above the admin nav bar.** `.shell` has `min-height: 100vh` — correct on
desktop, where it keeps the sidebar looking intentional even on short pages. On mobile,
once the shell becomes a single-column grid, that same min-height forces CSS Grid's
auto-sized rows to stretch and absorb whatever space is left over, inflating the rail's
own row height and vertically centering its short nav content within it — a visible gap
above the links. It didn't show up on the customer app because that page's content
already exceeds one screen; it was obvious on the admin console's shorter pages, where
there was real leftover space to distribute. Fixed by giving the mobile shell
`min-height: 0; align-content: start` — rows now pack at their natural size regardless
of viewport height.

**The oversized "no Google Ads connected" card.** `Empty` renders its own bordered
`.section` with 40px padding — correct when used standalone (8 of its 11 call sites
across the app). But Dashboard's three uses nest it *inside* another `.section`
wrapper, stacking two cards' worth of borders and padding (roughly 130px of dead space
before any text). Gave `Empty` an opt-in `compact` prop that drops the redundant
chrome, applied it only at those three nested call sites, and left the other eight
exactly as they were.