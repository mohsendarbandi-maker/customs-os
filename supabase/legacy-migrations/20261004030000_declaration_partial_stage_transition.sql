create or replace function public.advance_declaration_to_exit_stage(
  p_declaration_id uuid,
  p_remaining_items text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $function$
declare
  v_org uuid := public.user_org_id();
  v_role text := public.user_role()::text;
  v_old public.customs_declarations;
  v_remaining jsonb := to_jsonb(coalesce(p_remaining_items,'{}'::text[]));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if v_org is null or v_role not in ('owner','admin','broker','warehouse') then
    raise exception 'User is not allowed to advance declaration stage';
  end if;
  select * into v_old
  from public.customs_declarations
  where id=p_declaration_id and organization_id=v_org
  for update;
  if v_old.id is null then
    raise exception 'Declaration not found or access denied';
  end if;
  if v_old.workflow_stage is null or v_old.workflow_stage not in (4,5,6) then
    raise exception 'اظهارنامه در وضعیت قابل انتقال به مرحله درب خروج نیست';
  end if;
  update public.customs_declarations
  set workflow_stage=5, updated_at=now()
  where id=p_declaration_id and organization_id=v_org;
  insert into public.audit_logs(
    organization_id,user_id,action,table_name,record_id,old_data,new_data
  )
  values(
    v_org,
    auth.uid(),
    case when coalesce(array_length(p_remaining_items,1),0)>0
      then 'DECLARATION_PARTIAL_STAGE_ADVANCE'
      else 'DECLARATION_STAGE_ADVANCE'
    end,
    'customs_declarations',
    p_declaration_id,
    jsonb_build_object('workflow_stage',v_old.workflow_stage,'kottaj_number',v_old.kottaj_number),
    jsonb_build_object(
      'workflow_stage',5,
      'remaining_checklist_items',v_remaining,
      'partial_allowed',coalesce(array_length(p_remaining_items,1),0)>0,
      'reason','عبور عملیاتی به مرحله درب خروج؛ موارد باقی‌مانده قابل تکمیل در ادامه فرآیند هستند'
    )
  );
end;
$function$;
revoke all on function public.advance_declaration_to_exit_stage(uuid,text[]) from public, anon;
grant execute on function public.advance_declaration_to_exit_stage(uuid,text[]) to authenticated;