-- 005: Clarify Search — organic side, holistic overlap, model tuning, AI briefs.
-- Purely additive; safe on the live database.

-- ============ ORGANIC PROPERTIES (a website Clarify watches) ============
create table public.organic_properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_url text not null,
  status text not null default 'new',           -- new | crawling | ready | error
  status_detail text,
  pages_crawled int default 0,
  last_crawled_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (org_id, site_url)
);

create table public.organic_pages (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.organic_properties(id) on delete cascade,
  url text not null,
  path text,
  status_code int,
  is_money_page boolean default false,
  title text,
  meta_description text,
  h1 text,
  h1_count int default 0,
  word_count int default 0,
  canonical text,
  noindex boolean default false,
  images int default 0,
  images_missing_alt int default 0,
  internal_links int default 0,
  inbound_internal_links int default 0,
  schema_types text[] default '{}',
  has_faq_schema boolean default false,
  has_local_schema boolean default false,
  bytes int default 0,
  crawled_at timestamptz not null default now(),
  unique (property_id, url)
);
create index organic_pages_prop on public.organic_pages (property_id);

-- ============ SEARCH CONSOLE ============
create table public.gsc_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.organic_properties(id) on delete set null,
  site_url text,                                -- GSC property, e.g. sc-domain:example.com or https://example.com/
  refresh_token_ciphertext text not null,
  status text not null default 'active',        -- active | pending_selection | error | revoked
  status_detail text,
  connected_by uuid references public.profiles(id),
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.gsc_query_stats (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.gsc_connections(id) on delete cascade,
  query text not null,
  page text,
  clicks numeric default 0,
  impressions numeric default 0,
  ctr numeric default 0,
  position numeric default 0,
  window_days int default 28,
  synced_at timestamptz not null default now()
);
create index gsc_query_conn on public.gsc_query_stats (connection_id);

-- ============ ORGANIC AUDITS (same contract as paid: evidence-first findings) ============
create table public.organic_audits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.organic_properties(id) on delete cascade,
  triggered_by uuid references public.profiles(id),
  status text not null default 'running',       -- running | complete | failed
  score int,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.organic_findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.organic_audits(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  category text not null,
  severity text not null,                       -- critical | warning | opportunity | pass
  title text not null,
  summary text not null,
  recommendation text,
  evidence jsonb,
  status text not null default 'open',          -- open | resolved
  sort_order int default 0,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index organic_findings_audit on public.organic_findings (audit_id);

-- ============ MODEL TUNING (Cameron's weights + analyst notes drive scoring and AI) ============
create table public.model_settings (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'global',         -- global (one row) | org (per-org override)
  org_id uuid references public.organizations(id) on delete cascade,
  weights jsonb not null default '{}',          -- severity weights, per-category multipliers, thresholds
  notes jsonb not null default '{}',            -- { global: text, categories: { <category>: text } }
  version int not null default 1,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create unique index model_settings_global on public.model_settings (scope) where scope = 'global';
create unique index model_settings_org on public.model_settings (org_id) where scope = 'org';

-- ============ AI STRATEGIST BRIEFS ============
create table public.ai_briefs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.google_ads_connections(id) on delete set null,
  property_id uuid references public.organic_properties(id) on delete set null,
  brief_md text not null,
  model text,
  model_version int,                            -- model_settings.version used, for provenance
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index ai_briefs_org on public.ai_briefs (org_id, created_at desc);

-- ============ RLS ============
alter table public.organic_properties enable row level security;
alter table public.organic_pages enable row level security;
alter table public.gsc_connections enable row level security;
alter table public.gsc_query_stats enable row level security;
alter table public.organic_audits enable row level security;
alter table public.organic_findings enable row level security;
alter table public.model_settings enable row level security;
alter table public.ai_briefs enable row level security;

create policy oprop_select on public.organic_properties for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy oprop_insert on public.organic_properties for insert
  with check (org_id = private.user_org_id());
create policy oprop_delete on public.organic_properties for delete
  using (org_id = private.user_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));

create policy opage_select on public.organic_pages for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());

create policy gscc_select on public.gsc_connections for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy gscc_delete on public.gsc_connections for delete
  using (org_id = private.user_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));

create policy gscq_select on public.gsc_query_stats for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());

create policy oaudit_select on public.organic_audits for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());

create policy ofind_select on public.organic_findings for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy ofind_update on public.organic_findings for update
  using (org_id = private.user_org_id())
  with check (org_id = private.user_org_id());

-- model settings: Clarify-admin eyes only. Engines and briefs read via service role;
-- customers see the *effects* (scores, briefs, receipts), never the knobs or notes.
create policy model_select on public.model_settings for select
  using (private.is_clarify_admin());

create policy brief_select on public.ai_briefs for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
