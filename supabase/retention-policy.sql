-- Retire audit logging and automatically remove old tip history.
-- Run this once in Supabase Dashboard > SQL Editor, in the existing TipSplit project.
-- IMPORTANT: this permanently deletes the old audit_log rows and tip distributions
-- already older than 30 days. Employee records and newer tip history are preserved.

-- Stop generating audit rows now that the Audit Log feature is retired.
drop trigger if exists employees_audit_log_trigger on public.employees;
drop trigger if exists tip_records_audit_log_trigger on public.tip_records;
drop function if exists public.log_tipsplit_audit_event();
drop table if exists public.audit_log;

-- Apply the retention rule immediately to existing history.
delete from public.tip_records
where created_at < now() - interval '30 days';

-- Supabase Cron (pg_cron) runs the cleanup every day at 04:00 UTC.
-- If creating this extension fails, enable pg_cron in Dashboard > Integrations > Cron,
-- then run this script again.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Scheduling the same job name again replaces the existing job definition.
select cron.schedule(
  'tipsplit-delete-history-after-30-days',
  '0 4 * * *',
  $$
    delete from public.tip_records
    where created_at < now() - interval '30 days';
  $$
);

notify pgrst, 'reload schema';
