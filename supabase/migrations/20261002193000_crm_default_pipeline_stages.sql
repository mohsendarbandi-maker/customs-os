-- CRM default pipeline/stages: idempotent and organization-triggered.
create unique index if not exists crm_one_default_pipeline_per_org on public.crm_pipelines(organization_id) where is_default and deleted_at is null;
create or replace function public.ensure_crm_default_pipeline(p_org uuid)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare pid uuid;
begin
 select id into pid from public.crm_pipelines where organization_id=p_org and is_default and deleted_at is null order by created_at limit 1;
 if pid is null then insert into public.crm_pipelines(organization_id,name,is_default) values(p_org,'فروش و ترخیص',true) returning id into pid; end if;
 insert into public.crm_pipeline_stages(pipeline_id,name,position,probability)
 values (pid,'سرنخ جدید',0,10),(pid,'تماس اول',1,20),(pid,'پیشنهاد قیمت',2,40),(pid,'مذاکره',3,60),(pid,'برنده',4,100),(pid,'بازنده',5,0)
 on conflict(pipeline_id,position) do update set name=excluded.name,probability=excluded.probability,updated_at=now(),deleted_at=null;
 return pid;
end $$;
revoke all on function public.ensure_crm_default_pipeline(uuid) from public,anon,authenticated;
create or replace function public.trg_ensure_crm_default_pipeline()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$ begin perform public.ensure_crm_default_pipeline(new.id); return new; end $$;
revoke all on function public.trg_ensure_crm_default_pipeline() from public,anon,authenticated;
drop trigger if exists trg_organizations_crm_defaults on public.organizations;
create trigger trg_organizations_crm_defaults after insert on public.organizations for each row execute function public.trg_ensure_crm_default_pipeline();
do $$ declare r record; begin for r in select id from public.organizations loop perform public.ensure_crm_default_pipeline(r.id); end loop; end $$;
-- crm_pipeline_stages has no organization_id; generic record_audit_event is incompatible with it.
drop trigger if exists audit_crm_pipeline_stages on public.crm_pipeline_stages;
drop trigger if exists trg_crm_pipeline_stages_audit on public.crm_pipeline_stages;