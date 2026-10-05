-- Shipment cost registration + payment receipts.
-- Extends canonical finance_cost_items; no parallel expense table is introduced.

alter table public.finance_cost_items
  add column if not exists cost_type text,
  add column if not exists cost_category text,
  add column if not exists payment_date date,
  add column if not exists receipt_files jsonb,
  add column if not exists workflow_status text,
  add column if not exists uploaded_by uuid,
  add column if not exists submitted_by uuid,
  add column if not exists submitted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_reason text;

update public.finance_cost_items e
set cost_type=coalesce(nullif(e.cost_type,''),'MISC'),
    cost_category=coalesce(nullif(e.cost_category,''),c.name_fa,'متفرقه'),
    payment_date=coalesce(e.payment_date,e.occurred_at::date),
    receipt_files=coalesce(e.receipt_files,'[]'::jsonb),
    workflow_status=case when e.approval_status='approved' then 'APPROVED'
                         when e.approval_status='rejected' then 'REJECTED'
                         when e.approval_status='pending' then 'SUBMITTED'
                         else 'DRAFT' end,
    uploaded_by=coalesce(e.uploaded_by,e.created_by),
    submitted_by=case when e.approval_status in ('approved','rejected','pending') then coalesce(e.submitted_by,e.created_by) else e.submitted_by end,
    submitted_at=case when e.approval_status in ('approved','rejected','pending') then coalesce(e.submitted_at,e.created_at) else e.submitted_at end
from public.finance_cost_categories c
where c.id=e.category_id and c.organization_id=e.organization_id;

update public.finance_cost_items
set cost_type=coalesce(nullif(cost_type,''),'MISC'),
    cost_category=coalesce(nullif(cost_category,''),'متفرقه'),
    payment_date=coalesce(payment_date,occurred_at::date),
    receipt_files=coalesce(receipt_files,'[]'::jsonb),
    workflow_status=coalesce(workflow_status,'SUBMITTED'),
    uploaded_by=coalesce(uploaded_by,created_by);

alter table public.finance_cost_items
  alter column cost_type set default 'MISC',
  alter column cost_type set not null,
  alter column cost_category set default 'متفرقه',
  alter column cost_category set not null,
  alter column payment_date set default current_date,
  alter column payment_date set not null,
  alter column receipt_files set default '[]'::jsonb,
  alter column receipt_files set not null,
  alter column workflow_status set default 'DRAFT',
  alter column workflow_status set not null;

alter table public.finance_cost_items drop constraint if exists finance_cost_items_cost_type_check;
alter table public.finance_cost_items add constraint finance_cost_items_cost_type_check
check(cost_type=any(array['PRE_DECLARATION'::text,'DURING_DECLARATION'::text,'POST_DECLARATION'::text,'MISC'::text]));

alter table public.finance_cost_items drop constraint if exists finance_cost_items_cost_category_check;
alter table public.finance_cost_items add constraint finance_cost_items_cost_category_check
check(length(btrim(cost_category)) between 1 and 250);

alter table public.finance_cost_items drop constraint if exists finance_cost_items_workflow_status_check;
alter table public.finance_cost_items add constraint finance_cost_items_workflow_status_check
check(workflow_status=any(array['DRAFT'::text,'SUBMITTED'::text,'APPROVED'::text,'REJECTED'::text]));

alter table public.finance_cost_items drop constraint if exists finance_cost_items_receipt_files_array_check;
alter table public.finance_cost_items add constraint finance_cost_items_receipt_files_array_check
check(jsonb_typeof(receipt_files)='array');

alter table public.finance_cost_items drop constraint if exists finance_cost_items_uploaded_by_tenant_fk;
alter table public.finance_cost_items add constraint finance_cost_items_uploaded_by_tenant_fk
foreign key(uploaded_by,organization_id) references public.profiles(id,organization_id);

alter table public.finance_cost_items drop constraint if exists finance_cost_items_submitted_by_tenant_fk;
alter table public.finance_cost_items add constraint finance_cost_items_submitted_by_tenant_fk
foreign key(submitted_by,organization_id) references public.profiles(id,organization_id);

alter table public.finance_cost_items drop constraint if exists finance_cost_items_deleted_by_tenant_fk;
alter table public.finance_cost_items add constraint finance_cost_items_deleted_by_tenant_fk
foreign key(deleted_by,organization_id) references public.profiles(id,organization_id);

create index if not exists idx_finance_cost_items_shipment_payment_date
on public.finance_cost_items(organization_id,shipment_id,payment_date desc)
where deleted_at is null;

create index if not exists idx_finance_cost_items_shipment_workflow
on public.finance_cost_items(organization_id,shipment_id,workflow_status)
where deleted_at is null;

create index if not exists idx_finance_cost_items_stage_date
on public.finance_cost_items(organization_id,cost_type,payment_date desc)
where deleted_at is null;

create or replace function public.finance_shipment_cost_receipts_validate()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v jsonb; v_path text; v_mime text; v_size bigint; v_user text;
begin
 if new.receipt_files is null then new.receipt_files:='[]'::jsonb; end if;
 if pg_catalog.jsonb_typeof(new.receipt_files)<>'array' then raise exception 'receipt_files must be a JSON array'; end if;
 for v in select value from pg_catalog.jsonb_array_elements(new.receipt_files) loop
  v_path:=nullif(btrim(v->>'path'),'');
  v_mime:=lower(nullif(btrim(v->>'mime_type'),''));
  v_size:=case when (v->>'size_bytes')~'^[0-9]+$' then (v->>'size_bytes')::bigint else -1 end;
  v_user:=nullif(btrim(v->>'uploaded_by'),'');
  if v_path is null or v_mime is null or v_user is null then raise exception 'Each receipt metadata entry requires path, mime_type and uploaded_by'; end if;
  if v_size<=0 or v_size>10485760 then raise exception 'Each receipt must be between 1 byte and 10 MB'; end if;
  if v_mime not in ('application/pdf','image/jpeg','image/png') then raise exception 'Unsupported receipt MIME type'; end if;
  if v_path!~'^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.(pdf|jpg|jpeg|png)$' then raise exception 'Receipt storage path must use UUID filename format'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='finance-receipts' and o.name=v_path and (storage.foldername(o.name))[1]=new.organization_id::text and (storage.foldername(o.name))[2]=v_user) then
    raise exception 'Receipt file is missing or outside the organization/user storage boundary';
  end if;
 end loop;
 return new;
end;
$$;
revoke all on function public.finance_shipment_cost_receipts_validate() from public,anon,authenticated;

drop trigger if exists trg_finance_shipment_cost_receipts_validate on public.finance_cost_items;
create trigger trg_finance_shipment_cost_receipts_validate
before insert or update of receipt_files on public.finance_cost_items
for each row execute function public.finance_shipment_cost_receipts_validate();

create or replace function public.finance_shipment_cost_workflow_validate()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.workflow_status='DRAFT' then
  new.approval_status:='pending'; new.approved_by:=null; new.approved_at:=null; new.rejection_reason:=null; new.submitted_by:=null; new.submitted_at:=null;
 elsif new.workflow_status='SUBMITTED' then
  new.approval_status:='pending'; new.approved_by:=null; new.approved_at:=null; new.rejection_reason:=null;
  if new.submitted_by is null then new.submitted_by:=new.created_by; end if;
  if new.submitted_at is null then new.submitted_at:=now(); end if;
 elsif new.workflow_status='APPROVED' then
  new.approval_status:='approved';
  if new.approved_by is null or new.approved_at is null then raise exception 'Approved cost requires approval metadata'; end if;
  new.rejection_reason:=null;
  if new.submitted_by is null then new.submitted_by:=new.created_by; end if;
  if new.submitted_at is null then new.submitted_at:=coalesce(new.created_at,now()); end if;
 elsif new.workflow_status='REJECTED' then
  new.approval_status:='rejected';
  if nullif(btrim(coalesce(new.rejection_reason,'')),'') is null then raise exception 'Rejected cost requires a reason'; end if;
  new.approved_by:=null; new.approved_at:=null;
 end if;
 if tg_op='UPDATE' and old.workflow_status='APPROVED' and new.workflow_status<>'APPROVED' then raise exception 'Approved financial cost is immutable'; end if;
 return new;
end;
$$;
revoke all on function public.finance_shipment_cost_workflow_validate() from public,anon,authenticated;

drop trigger if exists trg_finance_shipment_cost_workflow_validate on public.finance_cost_items;
create trigger trg_finance_shipment_cost_workflow_validate
before insert or update of workflow_status,approval_status,approved_by,approved_at,rejection_reason,submitted_by,submitted_at
on public.finance_cost_items for each row execute function public.finance_shipment_cost_workflow_validate();

create or replace function public.finance_shipment_cost_immutable_fields()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.organization_id is distinct from old.organization_id
    or new.shipment_id is distinct from old.shipment_id
    or new.case_id is distinct from old.case_id
    or new.client_id is distinct from old.client_id
    or new.created_by is distinct from old.created_by
    or new.uploaded_by is distinct from old.uploaded_by
 then raise exception 'Shipment cost tenant, shipment, client and creator fields are immutable'; end if;
 if old.workflow_status='APPROVED' and new.workflow_status='APPROVED' and (
  new.cost_type is distinct from old.cost_type or new.cost_category is distinct from old.cost_category or
  new.description is distinct from old.description or new.amount is distinct from old.amount or
  new.currency is distinct from old.currency or new.exchange_rate is distinct from old.exchange_rate or
  new.payment_date is distinct from old.payment_date or new.receipt_files is distinct from old.receipt_files or
  new.paid_by is distinct from old.paid_by
 ) then raise exception 'Approved financial cost is immutable'; end if;
 return new;
end;
$$;
revoke all on function public.finance_shipment_cost_immutable_fields() from public,anon,authenticated;

drop trigger if exists trg_finance_shipment_cost_immutable_fields on public.finance_cost_items;
create trigger trg_finance_shipment_cost_immutable_fields
before update on public.finance_cost_items for each row execute function public.finance_shipment_cost_immutable_fields();

create or replace function public.create_finance_shipment_cost(
 p_shipment_id uuid,p_client_id uuid,p_cost_type text,p_category_id uuid,p_cost_category text,
 p_description text,p_amount numeric,p_currency text,p_exchange_rate numeric default 1,
 p_payment_date date default current_date,p_paid_by text default 'our_company',
 p_receipt_files jsonb default '[]'::jsonb,p_notes text default null
)
returns public.finance_cost_items language plpgsql security definer set search_path=''
as $$
declare v public.finance_cost_items; v_org uuid:=public.user_org_id(); v_user uuid:=auth.uid(); v_case uuid; v_name text; v_amount_irr numeric;
begin
 if v_user is null or v_org is null then raise exception 'Authentication required'; end if;
 if public.user_role()='client'::public.user_role then raise exception 'This finance action is not available to client users'; end if;
 if p_cost_type not in ('PRE_DECLARATION','DURING_DECLARATION','POST_DECLARATION','MISC') then raise exception 'Invalid cost stage'; end if;
 if p_currency not in ('IRR','USD','EUR') then raise exception 'Only IRR, USD and EUR are supported for shipment costs'; end if;
 if p_paid_by not in ('our_company','client_direct') then raise exception 'Invalid payer'; end if;
 if p_amount is null or p_amount<=0 then raise exception 'Amount must be greater than zero'; end if;
 if coalesce(p_exchange_rate,0)<=0 then raise exception 'Exchange rate must be greater than zero'; end if;
 if p_payment_date is null then raise exception 'Payment date is required'; end if;
 if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Cost description is required'; end if;
 if pg_catalog.jsonb_typeof(coalesce(p_receipt_files,'[]'::jsonb))<>'array' then raise exception 'receipt_files must be an array'; end if;
 select s.case_id into v_case from public.shipments s where s.id=p_shipment_id and s.organization_id=v_org and s.client_id=p_client_id;
 if v_case is null and not exists(select 1 from public.shipments s where s.id=p_shipment_id and s.organization_id=v_org and s.client_id=p_client_id) then raise exception 'Shipment/client combination is invalid'; end if;
 if not exists(select 1 from public.clients c where c.id=p_client_id and c.organization_id=v_org) then raise exception 'Client is invalid'; end if;
 select c.name_fa into v_name from public.finance_cost_categories c where c.id=p_category_id and c.organization_id=v_org and c.is_active=true;
 if v_name is null then raise exception 'Cost category is invalid or inactive'; end if;
 v_amount_irr:=round(p_amount*p_exchange_rate,2);
 insert into public.finance_cost_items(
  organization_id,shipment_id,case_id,client_id,category_id,cost_type,cost_category,description,
  quantity,unit,unit_price,amount,currency,exchange_rate,amount_irr,vat_rate,vat_amount,payable_by,
  billable,reimbursable,status,occurred_at,payment_date,notes,created_by,updated_by,uploaded_by,
  paid_by,approval_status,workflow_status,receipt_files,receipt_file_url
 )
 values(
  v_org,p_shipment_id,v_case,p_client_id,p_category_id,p_cost_type,
  coalesce(nullif(btrim(p_cost_category),''),v_name),btrim(p_description),1,'هزینه',p_amount,p_amount,
  p_currency::public.currency_code,p_exchange_rate,v_amount_irr,0,0,'client',p_paid_by='our_company',
  false,false,'draft',now(),p_payment_date,nullif(btrim(coalesce(p_notes,'')),''),
  v_user,v_user,v_user,p_paid_by,'pending','DRAFT',coalesce(p_receipt_files,'[]'::jsonb),
  case when pg_catalog.jsonb_array_length(coalesce(p_receipt_files,'[]'::jsonb))>0 then p_receipt_files->0->>'path' else null end
 )
 returning * into v;
 return v;
end;
$$;
revoke all on function public.create_finance_shipment_cost(uuid,uuid,text,uuid,text,text,numeric,text,numeric,date,text,jsonb,text) from public,anon;
grant execute on function public.create_finance_shipment_cost(uuid,uuid,text,uuid,text,text,numeric,text,numeric,date,text,jsonb,text) to authenticated;

create or replace function public.submit_finance_shipment_cost(p_cost_id uuid)
returns public.finance_cost_items language plpgsql security definer set search_path=''
as $$
declare v public.finance_cost_items;
begin
 if auth.uid() is null or public.user_org_id() is null then raise exception 'Authentication required'; end if;
 update public.finance_cost_items
 set workflow_status='SUBMITTED',submitted_by=auth.uid(),submitted_at=now(),updated_by=auth.uid(),updated_at=now(),
     approval_status='pending',approved_by=null,approved_at=null,rejection_reason=null,status='draft'
 where id=p_cost_id and organization_id=public.user_org_id() and created_by=auth.uid()
   and workflow_status in ('DRAFT','REJECTED') and deleted_at is null
   and pg_catalog.jsonb_array_length(coalesce(receipt_files,'[]'::jsonb))>0
 returning * into v;
 if not found then raise exception 'Only your draft/rejected cost with at least one receipt can be submitted'; end if;
 return v;
end;
$$;
revoke all on function public.submit_finance_shipment_cost(uuid) from public,anon;
grant execute on function public.submit_finance_shipment_cost(uuid) to authenticated;

create or replace function public.archive_finance_shipment_cost(p_cost_id uuid,p_reason text)
returns public.finance_cost_items language plpgsql security definer set search_path=''
as $$
declare v public.finance_cost_items;
begin
 if auth.uid() is null or public.user_org_id() is null then raise exception 'Authentication required'; end if;
 if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Archive reason is required'; end if;
 update public.finance_cost_items
 set deleted_at=now(),deleted_by=auth.uid(),deleted_reason=btrim(p_reason),updated_by=auth.uid(),updated_at=now(),status='cancelled'
 where id=p_cost_id and organization_id=public.user_org_id() and deleted_at is null and workflow_status<>'APPROVED'
   and (public.user_role() in ('owner'::public.user_role,'admin'::public.user_role) or created_by=auth.uid())
 returning * into v;
 if not found then raise exception 'Cost not found or cannot be archived'; end if;
 return v;
end;
$$;
revoke all on function public.archive_finance_shipment_cost(uuid,text) from public,anon;
grant execute on function public.archive_finance_shipment_cost(uuid,text) to authenticated;

create or replace function public.finance_shipment_cost_summary(p_shipment_id uuid)
returns jsonb language sql security invoker set search_path=''
as $$
select jsonb_build_object(
 'registered_irr',coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)),0),
 'approved_irr',coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)) filter(where e.workflow_status='APPROVED'),0),
 'submitted_irr',coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)) filter(where e.workflow_status='SUBMITTED'),0),
 'draft_irr',coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)) filter(where e.workflow_status='DRAFT'),0),
 'rejected_irr',coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)) filter(where e.workflow_status='REJECTED'),0),
 'by_stage',jsonb_build_object(
  'PRE_DECLARATION',coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)) filter(where e.workflow_status='APPROVED' and e.cost_type='PRE_DECLARATION'),0),
  'DURING_DECLARATION',coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)) filter(where e.workflow_status='APPROVED' and e.cost_type='DURING_DECLARATION'),0),
  'POST_DECLARATION',coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)) filter(where e.workflow_status='APPROVED' and e.cost_type='POST_DECLARATION'),0),
  'MISC',coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)) filter(where e.workflow_status='APPROVED' and e.cost_type='MISC'),0)
 )
)
from public.finance_cost_items e
where e.organization_id=public.user_org_id() and e.shipment_id=p_shipment_id and e.deleted_at is null;
$$;
revoke all on function public.finance_shipment_cost_summary(uuid) from public,anon;
grant execute on function public.finance_shipment_cost_summary(uuid) to authenticated;

create or replace function public.approve_finance_expense(p_expense_id uuid,p_approve boolean,p_rejection_reason text default null)
returns public.finance_cost_items language plpgsql security definer set search_path=''
as $$
declare v public.finance_cost_items;
begin
 if auth.uid() is null or public.user_org_id() is null then raise exception 'Authentication required'; end if;
 if public.user_role() not in ('owner'::public.user_role,'admin'::public.user_role)
    and not private.finance_has_permission('approve_other_expenses') then raise exception 'Expense approval permission required'; end if;
 select e.* into v from public.finance_cost_items e
 where e.id=p_expense_id and e.organization_id=public.user_org_id() and e.workflow_status='SUBMITTED' and e.deleted_at is null;
 if not found then raise exception 'Expense not found or already decided'; end if;
 if v.created_by=auth.uid() then raise exception 'Expense creator cannot approve or reject their own expense'; end if;
 if not p_approve and nullif(btrim(coalesce(p_rejection_reason,'')),'') is null then raise exception 'Rejection reason is required'; end if;
 if pg_catalog.jsonb_array_length(coalesce(v.receipt_files,'[]'::jsonb))=0 and v.receipt_file_url is null then raise exception 'A payment receipt is required before approval'; end if;
 update public.finance_cost_items
 set workflow_status=case when p_approve then 'APPROVED' else 'REJECTED' end,
     approval_status=case when p_approve then 'approved' else 'rejected' end,
     status=case when p_approve then 'confirmed' else 'cancelled' end,
     approved_by=case when p_approve then auth.uid() else null end,
     approved_at=case when p_approve then now() else null end,
     rejection_reason=case when p_approve then null else btrim(p_rejection_reason) end,
     updated_by=auth.uid(),updated_at=now()
 where id=p_expense_id and organization_id=public.user_org_id() and workflow_status='SUBMITTED'
 returning * into v;
 return v;
end;
$$;
revoke all on function public.approve_finance_expense(uuid,boolean,text) from public,anon;
grant execute on function public.approve_finance_expense(uuid,boolean,text) to authenticated;

-- Canonical audit trigger: exactly once.
drop trigger if exists tr_owner_console_audit on public.finance_cost_items;
drop trigger if exists tr_finance_cost_audit on public.finance_cost_items;
create trigger tr_finance_cost_audit after insert or update or delete
on public.finance_cost_items for each row execute function public.record_audit_event();

-- Private receipt storage.
update storage.buckets
set public=false,file_size_limit=10485760,
    allowed_mime_types=array['application/pdf','image/jpeg','image/png']
where id='finance-receipts';

do $$
declare r record;
begin
 for r in select policyname from pg_policies
 where schemaname='storage' and tablename='objects'
   and (coalesce(qual,'') ilike '%finance-receipts%' or coalesce(with_check,'') ilike '%finance-receipts%')
 loop execute format('drop policy if exists %I on storage.objects',r.policyname); end loop;
end
$$;

create policy finance_receipts_insert on storage.objects
for insert to authenticated
with check(
 bucket_id='finance-receipts'
 and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'warehouse'::public.user_role,'accountant'::public.user_role)
 and (storage.foldername(name))[1]=(select public.user_org_id())::text
 and (storage.foldername(name))[2]=(select auth.uid())::text
 and (storage.foldername(name))[3]~'^[0-9a-fA-F-]{36}\.(pdf|jpg|jpeg|png)$'
);

create policy finance_receipts_select on storage.objects
for select to authenticated
using(
 bucket_id='finance-receipts'
 and (storage.foldername(name))[1]=(select public.user_org_id())::text
 and (
   ((storage.foldername(name))[2]=(select auth.uid())::text and (select private.finance_has_permission('view_own_receipts')))
   or (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
   or (select private.finance_has_permission('view_org_financials'))
   or (select private.finance_has_permission('approve_other_expenses'))
 )
);

create policy finance_receipts_delete on storage.objects
for delete to authenticated
using(
 bucket_id='finance-receipts'
 and (storage.foldername(name))[1]=(select public.user_org_id())::text
 and (
   (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
   or (
     (storage.foldername(name))[2]=(select auth.uid())::text
     and not exists(
       select 1 from public.finance_cost_items e
       where e.organization_id=(select public.user_org_id())
         and e.workflow_status='APPROVED' and e.deleted_at is null
         and e.receipt_files @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path',objects.name))
     )
   )
 )
);

create policy finance_receipts_update on storage.objects
for update to authenticated using(false) with check(false);
