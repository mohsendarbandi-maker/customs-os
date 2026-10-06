-- Keep account preferences and organization defaults in their existing
-- respective rows. Older versions stored some organization keys in user_settings
-- and some personal keys in organization_settings; remove only the known
-- duplicated keys while preserving all unknown settings.

CREATE OR REPLACE FUNCTION public.record_user_settings_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_catalog','pg_temp'
AS $function$
declare
  v_id uuid := case when tg_op='DELETE' then old.user_id else new.user_id end;
  v_org uuid := coalesce(
    public.user_org_id(),
    (select p.organization_id from public.profiles p where p.id=v_id)
  );
  v_actor uuid := coalesce(auth.uid(),v_id);
begin
  insert into public.audit_logs(
    organization_id,user_id,action,table_name,record_id,old_data,new_data
  )
  values(
    v_org,v_actor,tg_op,'user_settings',v_id,
    case when tg_op='DELETE' or tg_op='UPDATE' then to_jsonb(old) else null end,
    case when tg_op='INSERT' or tg_op='UPDATE' then to_jsonb(new) else null end
  );
  return coalesce(new,old);
end;
$function$;

REVOKE ALL ON FUNCTION public.record_user_settings_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_user_settings_audit() TO authenticated;

UPDATE public.user_settings
SET settings = COALESCE(settings, '{}'::jsonb)
  - ARRAY[
      'defaultPort',
      'defaultCustomsOffice',
      'defaultWorkflow',
      'currency',
      'exchangeMode',
      'vatRate',
      'documentMaxMb',
      'retentionDays',
      'vesselAutoRefresh',
      'casePrefix',
      'documentPrefix',
      'shipmentPrefix',
      'storageRetentionDays',
      'transactionPrefix',
      'vesselRefresh',
      'numberPrefix',
      'numberingPrefix',
      'numberingDigits',
      'numberingYear',
      'numberingMonth',
      'duplicateClients',
      'casePrefix',
      'documentPrefix',
      'shipmentPrefix',
      'storageRetentionDays',
      'transactionPrefix',
      'vesselRefresh'
    ]::text[],
    updated_at = now()
WHERE settings IS NOT NULL;

UPDATE public.organization_settings
SET settings = COALESCE(settings, '{}'::jsonb)
  - ARRAY[
      'theme',
      'density',
      'comfort',
      'sidebarCollapsed',
      'calendar',
      'timezone',
      'reminderEnabled',
      'desktopNotifications',
      'sessionMinutes',
      'timeFormat',
      'language',
      'chat',
      'fontSize',
      'animations',
      'reducedMotion',
      'stickyHeader',
      'zebraRows',
      'hoverRows',
      'autoSave',
      'quietHours',
      'quietFrom',
      'quietTo'
    ]::text[],
    updated_at = now()
WHERE settings IS NOT NULL;
