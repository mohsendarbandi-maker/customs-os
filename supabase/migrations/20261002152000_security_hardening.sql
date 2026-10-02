-- Security hardening for public SECURITY DEFINER functions.
-- Anonymous/public callers must never be able to execute privileged RPCs.
revoke execute on function public.update_declaration_checklist_item(uuid,boolean) from public,anon;
revoke execute on function public.create_audit_guest_profile() from public,anon;
revoke execute on function public.record_org_settings_audit() from public,anon;
revoke execute on function public.record_organization_audit() from public,anon;
revoke execute on function public.record_global_reference_audit() from public,anon;
revoke execute on function public.record_user_settings_audit() from public,anon;
revoke execute on function public.ensure_financial_permission_row() from public,anon;
revoke execute on function public.create_finance_expense(uuid,uuid,uuid,text,numeric,text,numeric,text,text,text) from public,anon;
revoke execute on function public.chat_guard_message_mutation() from public,anon;
revoke execute on function public.chat_sync_delivery_status() from public,anon;
revoke execute on function public.chat_enqueue_message_notifications() from public,anon;
alter function public.guard_finance_role_updates() set search_path=public;
