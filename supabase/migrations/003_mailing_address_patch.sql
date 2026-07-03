-- 003: run this ONLY if you already ran the earlier version of 002 before this update.
-- (The updated 002 includes it — running both is harmless thanks to IF NOT EXISTS.)
alter table public.organizations add column if not exists mailing_address text;
