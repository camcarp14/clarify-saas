-- Clarify Paid Search — initial schema. Run in Supabase SQL editor or via CLI migrations.
create schema if not exists private;

-- ============ CORE TENANCY ============
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  subscription_status text not null default 'trialing', -- trialing|active|past_due|canceled
  plan_tier text not null default 'starter',            -- starter|growth|pro
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'owner',                   -- owner|member
  is_clarify_admin boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.profiles(org_id);

-- Security-definer helpers (bypass RLS safely; written once, reused in every policy)
create or replace function private.user_org_id() returns uuid
language sql stable security definer set search_path = '' as
$$ select org_id from public.profiles where id = auth.uid() $$;

create or replace function private.is_clarify_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select is_clarify_admin from public.profiles where id = auth.uid()), false) $$;

grant usage on schema private to authenticated, anon;
grant execute on all functions in schema private to authenticated;

-- Signup trigger: new auth user -> new org + owner profile
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare new_org uuid;
begin
  insert into public.organizations (name)
  values (coalesce(new.raw_user_meta_data->>'company_name', 'My Business'))
  returning id into new_org;
  insert into public.profiles (id, org_id, email, full_name)
  values (new.id, new_org, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

-- Make yourself super-admin after signup: select private.make_clarify_admin('you@clarifypaidsearch.com');
create or replace function private.make_clarify_admin(admin_email text) returns void
language sql security definer set search_path = '' as
$$ update public.profiles set is_clarify_admin = true where email = admin_email $$;

-- ============ GOOGLE ADS ============
create table public.google_ads_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id text not null default '',                 -- Google Ads CID, digits only ('' while pending selection)
  descriptive_name text,
  refresh_token_ciphertext text not null,               -- AES-256-GCM, key lives only in Netlify env
  status text not null default 'pending_selection',     -- pending_selection|active|revoked|error
  last_synced_at timestamptz,
  last_sync_error text,
  connected_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index one_cid_per_org on public.google_ads_connections(org_id, customer_id) where customer_id <> '';
create index on public.google_ads_connections(org_id);

-- Daily per-campaign metrics cache. Dashboard reads THIS, never Google live.
create table public.metrics_snapshots (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.google_ads_connections(id) on delete cascade,
  snapshot_date date not null,
  campaign_id text not null,
  campaign_name text,
  channel_type text,                                    -- SEARCH|PERFORMANCE_MAX|...
  campaign_status text,
  bidding_strategy text,
  budget_micros bigint default 0,
  cost_micros bigint not null default 0,
  clicks int not null default 0,
  impressions bigint not null default 0,
  conversions numeric not null default 0,
  conversions_value numeric not null default 0,
  search_impression_share numeric,
  search_budget_lost_is numeric,
  unique(connection_id, snapshot_date, campaign_id)
);
create index on public.metrics_snapshots(org_id);
create index on public.metrics_snapshots(connection_id, snapshot_date);

-- Last-30d keyword aggregates, refreshed each sync (delete + insert)
create table public.keyword_stats (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.google_ads_connections(id) on delete cascade,
  campaign_id text, campaign_name text,
  ad_group_id text, ad_group_name text,
  keyword_text text, match_type text, kw_status text,
  quality_score int,
  cost_micros bigint default 0, clicks int default 0, conversions numeric default 0,
  synced_at timestamptz not null default now()
);
create index on public.keyword_stats(connection_id);
create index on public.keyword_stats(org_id);

-- Last-30d search term aggregates
create table public.search_term_stats (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.google_ads_connections(id) on delete cascade,
  campaign_id text, ad_group_id text,
  term text, matched_keyword text,
  cost_micros bigint default 0, clicks int default 0, conversions numeric default 0,
  synced_at timestamptz not null default now()
);
create index on public.search_term_stats(connection_id);
create index on public.search_term_stats(org_id);

-- One row per sync: structure counts used by the audit engine
create table public.account_snapshots (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.google_ads_connections(id) on delete cascade,
  structure jsonb not null,   -- {negatives_campaign, negatives_adgroup, shared_neg_lists, ad_groups, rsa_by_adgroup, ad_strength_counts,...}
  synced_at timestamptz not null default now()
);
create index on public.account_snapshots(connection_id, synced_at desc);
create index on public.account_snapshots(org_id);

-- ============ AUDITS ============
create table public.audits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.google_ads_connections(id) on delete cascade,
  status text not null default 'running',               -- running|complete|failed
  score int,                                            -- 0-100
  triggered_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.audits(org_id, created_at desc);

create table public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  category text not null,      -- conversion_tracking|search_term_waste|match_type|smart_bidding|pmax|negatives|budget_pacing|structure|quality_score|ad_copy
  severity text not null,      -- critical|warning|opportunity|pass
  title text not null,
  summary text not null,       -- plain-English, TEMPLATED FROM evidence (never free-typed)
  recommendation text,
  evidence jsonb not null,     -- {window, formula, inputs:{...}, result:{...}} — the traceability contract
  status text not null default 'open',                  -- open|resolved|dismissed
  resolved_by uuid, resolved_at timestamptz,
  sort_order int default 0
);
create index on public.audit_findings(audit_id);
create index on public.audit_findings(org_id, status);

-- ============ ALERTS ============
create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.google_ads_connections(id) on delete cascade,
  rule_type text not null,     -- budget_pace|cpa_spike|conversion_tracking|pmax_brand
  config jsonb not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(connection_id, rule_type)
);
create index on public.alert_rules(org_id);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.google_ads_connections(id) on delete cascade,
  rule_type text not null,
  severity text not null,      -- critical|warning
  title text not null,
  body text not null,
  evidence jsonb not null default '{}',
  triggered_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  emailed_at timestamptz
);
create index on public.alerts(org_id, triggered_at desc);
create index on public.alerts(connection_id, rule_type, triggered_at desc);

-- ============ AGENCY-ASSIST SEAM (schema only, no logic yet) ============
create table public.delegations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  delegate_user_id uuid not null references public.profiles(id),
  scope text not null default 'read',                   -- read|manage (future)
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- ============ SUPPORT / SECURITY TRAIL ============
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  org_id uuid,
  action text not null,        -- e.g. admin_view_as_tenant, connection_deleted
  target text,
  meta jsonb default '{}',
  created_at timestamptz not null default now()
);
create index on public.audit_log(org_id, created_at desc);

-- Stripe webhook idempotency
create table public.stripe_events (
  id text primary key,         -- Stripe event id
  processed_at timestamptz not null default now()
);

-- ============ RLS ============
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.google_ads_connections enable row level security;
alter table public.metrics_snapshots enable row level security;
alter table public.keyword_stats enable row level security;
alter table public.search_term_stats enable row level security;
alter table public.account_snapshots enable row level security;
alter table public.audits enable row level security;
alter table public.audit_findings enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alerts enable row level security;
alter table public.delegations enable row level security;
alter table public.audit_log enable row level security;
alter table public.stripe_events enable row level security;  -- service-role only: no policies

-- organizations
create policy org_select on public.organizations for select
  using (id = private.user_org_id() or private.is_clarify_admin());
create policy org_update on public.organizations for update
  using (id = private.user_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'))
  with check (id = private.user_org_id());

-- profiles
create policy profiles_select on public.profiles for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and org_id = private.user_org_id());

-- tenant-scoped read for all data tables (+ admin bypass); writes come from service role
create policy conn_select on public.google_ads_connections for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy conn_delete on public.google_ads_connections for delete
  using (org_id = private.user_org_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));

create policy metrics_select on public.metrics_snapshots for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy kw_select on public.keyword_stats for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy terms_select on public.search_term_stats for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy acct_select on public.account_snapshots for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy audits_select on public.audits for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());

create policy findings_select on public.audit_findings for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy findings_update on public.audit_findings for update
  using (org_id = private.user_org_id())
  with check (org_id = private.user_org_id());

create policy rules_select on public.alert_rules for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy rules_update on public.alert_rules for update
  using (org_id = private.user_org_id()) with check (org_id = private.user_org_id());

create policy alerts_select on public.alerts for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy alerts_update on public.alerts for update
  using (org_id = private.user_org_id()) with check (org_id = private.user_org_id());

create policy delegations_select on public.delegations for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());

create policy audit_log_insert on public.audit_log for insert
  with check (actor_id = auth.uid());
create policy audit_log_select_admin on public.audit_log for select
  using (private.is_clarify_admin());
