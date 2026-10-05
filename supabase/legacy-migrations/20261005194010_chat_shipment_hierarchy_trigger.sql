begin;

create or replace function public.chat_ensure_shipment_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_owner_room_id uuid;
  v_user_id uuid := auth.uid();
begin
  if NEW.client_id is null then
    return NEW;
  end if;

  insert into public.chat_conversations(
    organization_id,type,title,related_type,related_id,
    cargo_owner_id,hierarchy_kind,created_by
  )
  select
    NEW.organization_id,
    'group',
    c.name,
    'cargo_owner',
    c.id,
    c.id,
    'owner_group',
    v_user_id
  from public.clients c
  where c.id=NEW.client_id
    and c.organization_id=NEW.organization_id
  on conflict do nothing;

  select r.id into v_owner_room_id
  from public.chat_conversations r
  where r.organization_id=NEW.organization_id
    and r.cargo_owner_id=NEW.client_id
    and r.hierarchy_kind='owner_group'
    and r.deleted_at is null
  limit 1;

  if v_owner_room_id is null then
    return NEW;
  end if;

  insert into public.chat_conversations(
    organization_id,type,title,related_type,related_id,
    parent_conversation_id,cargo_owner_id,shipment_id,
    hierarchy_kind,created_by
  )
  values(
    NEW.organization_id,
    'related',
    coalesce(nullif(trim(NEW.display_name),''),nullif(trim(NEW.bill_of_lading_no),''),'محموله'),
    'shipment',
    NEW.id,
    v_owner_room_id,
    NEW.client_id,
    NEW.id,
    'shipment_group',
    v_user_id
  )
  on conflict do nothing;

  return NEW;
end;
$function$;

revoke all on function public.chat_ensure_shipment_hierarchy() from public,anon,authenticated;

drop trigger if exists trg_chat_ensure_shipment_hierarchy on public.shipments;

create trigger trg_chat_ensure_shipment_hierarchy
after insert or update of client_id,display_name,bill_of_lading_no
on public.shipments
for each row
execute function public.chat_ensure_shipment_hierarchy();

commit;