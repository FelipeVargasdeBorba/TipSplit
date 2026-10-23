-- Run once in Supabase SQL Editor before deploying this TipSplit version.
-- Preserve existing employees and history while enabling the new policy.
alter table public.employees
  add column if not exists is_supervisor boolean not null default false;

-- A split is now dated by the date it is saved, not by a selected business date.
-- Allow more than one distribution to be saved on the same calendar date.
alter table public.tip_records
  drop constraint if exists tip_records_workspace_id_business_date_key;
