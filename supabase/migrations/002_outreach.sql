-- Clarify — 002: Outreach module, merged into the existing Clarify Paid Search schema.
-- Reuses organizations/profiles/private.user_org_id()/private.is_clarify_admin() as-is.
-- Purely additive: safe to run on the live project from 001_init.sql.

-- One bundled subscription now covers both modules — add credits tracking to the existing org row,
-- plus the mailing address that CAN-SPAM requires in every outreach email footer.
alter table public.organizations
  add column if not exists mailing_address text,
  add column if not exists monthly_credits int not null default 300,
  add column if not exists credits_used int not null default 0,
  add column if not exists period_started_at timestamptz not null default now();

-- ============ COMMS CONNECTIONS (email/SMS sending — distinct from google_ads_connections) ============
-- kind: gmail | outlook | smtp_imap | sms_twilio
create table public.comms_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  label text,
  address text not null,
  credentials_ciphertext text not null,
  status text not null default 'active',
  daily_send_cap int not null default 50,
  last_synced_at timestamptz,
  last_error text,
  connected_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.comms_connections(org_id);
create index on public.comms_connections(kind, address);

-- ============ LEADS ============
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source text not null default 'manual',
  external_id text,
  name text, company text, title text,
  email text, phone text, website text, linkedin_url text,
  address text, city text, region text, country text,
  rating numeric, review_count int,
  status text not null default 'new',
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.leads(org_id, status);
create unique index leads_org_external on public.leads(org_id, external_id) where external_id is not null;
create unique index leads_org_email on public.leads(org_id, lower(email)) where email is not null and email <> '';

create table public.lead_enrichment (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  site_title text, site_description text,
  emails_found text[] default '{}',
  socials jsonb default '{}', tech jsonb default '{}', signals jsonb default '{}',
  content_excerpt text,
  fetched_at timestamptz not null default now()
);
create index on public.lead_enrichment(org_id);

create table public.discovery_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  adapter text not null,
  criteria jsonb not null default '{}',
  status text not null default 'complete',
  results_count int default 0,
  credits_spent int default 0,
  error text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.discovery_jobs(org_id, created_at desc);

-- ============ SEQUENCES ============
create table public.sequences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  stop_on_reply boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.sequences(org_id);

create table public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  step_order int not null,
  channel text not null default 'email',
  delay_days int not null default 0,
  subject text, body text not null default '',
  use_ai boolean not null default false,
  created_at timestamptz not null default now(),
  unique(sequence_id, step_order)
);
create index on public.sequence_steps(org_id);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  connection_id uuid references public.comms_connections(id) on delete set null,
  status text not null default 'active',
  current_step int not null default 0,
  next_run_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  enrolled_by uuid,
  created_at timestamptz not null default now(),
  unique(sequence_id, lead_id)
);
create index on public.enrollments(status, next_run_at);
create index on public.enrollments(org_id);
create index on public.enrollments(lead_id);

-- ============ MESSAGES (the unified inbox) ============
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  connection_id uuid references public.comms_connections(id) on delete set null,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  channel text not null,
  direction text not null,
  status text not null default 'sent',
  subject text, body_text text, snippet text,
  rfc_message_id text, in_reply_to text, references_header text, provider_id text,
  occurred_at timestamptz not null default now(),
  is_read boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index on public.messages(org_id, lead_id, occurred_at);
create index on public.messages(org_id, direction, is_read);
create index on public.messages(rfc_message_id);
create unique index messages_provider_dedupe on public.messages(connection_id, provider_id) where provider_id is not null;

-- ============ CONSENT + SUPPRESSION ============
create table public.consent_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel text not null,
  method text not null,
  captured_at timestamptz not null default now(),
  captured_by uuid,
  evidence jsonb not null default '{}'
);
create index on public.consent_log(lead_id, channel);
create index on public.consent_log(org_id);

create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  value text not null,
  reason text not null default 'unsubscribed',
  created_at timestamptz not null default now(),
  unique(org_id, value)
);
create index on public.suppressions(org_id);

-- ============ RLS — reusing the existing private.user_org_id() / private.is_clarify_admin() ============
alter table public.comms_connections enable row level security;
alter table public.leads enable row level security;
alter table public.lead_enrichment enable row level security;
alter table public.discovery_jobs enable row level security;
alter table public.sequences enable row level security;
alter table public.sequence_steps enable row level security;
alter table public.enrollments enable row level security;
alter table public.messages enable row level security;
alter table public.consent_log enable row level security;
alter table public.suppressions enable row level security;

create policy conn_select on public.comms_connections for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy conn_update on public.comms_connections for update
  using (org_id = private.user_org_id()) with check (org_id = private.user_org_id());
create policy conn_delete on public.comms_connections for delete
  using (org_id = private.user_org_id());

create policy leads_all on public.leads for all
  using (org_id = private.user_org_id() or private.is_clarify_admin())
  with check (org_id = private.user_org_id());

create policy enrich_select on public.lead_enrichment for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());

create policy jobs_select on public.discovery_jobs for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());

create policy seq_all on public.sequences for all
  using (org_id = private.user_org_id() or private.is_clarify_admin())
  with check (org_id = private.user_org_id());
create policy steps_all on public.sequence_steps for all
  using (org_id = private.user_org_id() or private.is_clarify_admin())
  with check (org_id = private.user_org_id());

create policy enroll_select on public.enrollments for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy enroll_update on public.enrollments for update
  using (org_id = private.user_org_id()) with check (org_id = private.user_org_id());

create policy msg_select on public.messages for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy msg_update on public.messages for update
  using (org_id = private.user_org_id()) with check (org_id = private.user_org_id());

create policy consent_select on public.consent_log for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy consent_insert on public.consent_log for insert
  with check (org_id = private.user_org_id() and captured_by = auth.uid());

create policy suppress_select on public.suppressions for select
  using (org_id = private.user_org_id() or private.is_clarify_admin());
create policy suppress_insert on public.suppressions for insert
  with check (org_id = private.user_org_id());
