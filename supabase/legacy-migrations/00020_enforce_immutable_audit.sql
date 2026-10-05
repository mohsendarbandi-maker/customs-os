-- 00020: Audit logs and status histories are immutable for application roles.
REVOKE UPDATE, DELETE ON public.audit_logs FROM authenticated;
REVOKE UPDATE, DELETE ON public.case_status_history FROM authenticated;
REVOKE UPDATE, DELETE ON public.shipment_tracking_events FROM authenticated;
GRANT SELECT ON public.audit_logs, public.case_status_history, public.shipment_tracking_events TO authenticated;
