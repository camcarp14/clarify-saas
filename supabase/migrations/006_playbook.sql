-- 006: Organic Playbook — the priced-and-drafted layer on top of the organic audit.
-- Purely additive; safe on the live database. Run after 005.

-- richer page records: everything the money map, forge, and AI-readiness rules read
alter table public.organic_pages
  add column if not exists role text,                       -- home | money | content | trust | utility | other
  add column if not exists outlinks text[] default '{}',    -- same-origin links (drives depth, orphan, link-plan)
  add column if not exists h2s text[] default '{}',
  add column if not exists questions text[] default '{}',   -- question-formatted headings (AI answer capsules)
  add column if not exists first_text text,                 -- first ~340 chars of real text
  add column if not exists phones text[] default '{}',
  add column if not exists address_hint boolean default false,
  add column if not exists price_signals boolean default false,
  add column if not exists has_org_schema boolean default false;

-- findings become playbook-ready: which pillar, what it's worth, and the fix pointer
alter table public.organic_findings
  add column if not exists pillar text,                     -- foundation | demand | ai
  add column if not exists value_month numeric,             -- $/mo at stake (demand pillar), at the audit's value-per-click
  add column if not exists fix jsonb;                       -- { forge: titles|schema|links|brief|redirects, targets?: [], queries?: [] }

-- audit gains its subscores + the assumptions everything was priced with
alter table public.organic_audits
  add column if not exists sub jsonb;                       -- { scores:{foundation,demand,coverage,ai}, pipeline_value, capture_rate,
                                                            --   clicks_month, value_per_click, vpc_source, top_tasks:[...], model_version }
