-- Remove the unused generic scheduled-report subsystem.
-- Confirmed empty, with no application RPC, cron, Edge Function or UI dependencies.
-- Messenger daily reports use messenger_report_runs and remain untouched.
-- Shipment reporting uses file_manager_shipment_reports and remains untouched.
begin;

drop table if exists
  public.report_schedule_targets,
  public.report_runs,
  public.report_schedules
cascade;

commit;
