-- 004: Admin console — purely additive, safe on the live database.
alter table public.organizations add column if not exists suspended_at timestamptz;
alter table public.organizations add column if not exists internal_notes text;
