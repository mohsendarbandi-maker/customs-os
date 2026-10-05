-- Customs OS Finance Management Module
create schema if not exists private;
-- Canonical finance tables are extended; no duplicate case_expenses/payment_requests tables are introduced.

alter table public.finance_cost_items
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists receipt_file_url text;

alter table public.finance_org_settings
  add column if not exists receipt_mandatory_threshold_irr numeric(18,2) not null default 0;

alter table public.finance_cost_items drop constraint if exists finance_cost_items_paid_by_check;
update public.finance_cost_items set paid_by='our_company' where paid_by='organization';
update public.finance_cost_items set paid_by='client_direct' where paid_by='client';
alter table public.finance_cost_items
  add constraint finance_cost_items_paid_by_check
  check (paid_by = any(array['our_company'::text,'client_direct'::text]));

alter table public.finance_cost_items drop constraint if exists finance_cost_items_approval_status_check;
alter table public.finance_cost_items
  add constraint finance_cost_items_approval_status_check
  check (approval_status = any(array['pending'::text,'approved'::text,'rejected'::text]));

alter table public.finance_cost_items
  add constraint finance_cost_items_approved_by_tenant_fk
  foreign key (approved_by,organization_id) references public.profiles(id,organization_id);

alter table public.finance_cost_items drop constraint if exists finance_cost_items_approved_meta_check;
alter table public.finance_cost_items
  add constraint finance_cost_items_approved_meta_check
  check (
    (approval_status='pending' and approved_by is null and approved_at is null and rejection_reason is null)
    or (approval_status='approved' and approved_by is not null and approved_at is not null and rejection_reason is null)
    or (approval_status='rejected' and rejection_reason is not null)
  );

update public.finance_cost_items
set approval_status='approved',
    approved_by=coalesce(approved_by,created_by),
    approved_at=coalesce(approved_at,created_at)
where approval_status='pending' and status in ('confirmed','invoiced','paid');

create or replace function public.finance_expense_validate_amount()
returns trigger language plpgsql security definer
set search_path='public','pg_catalog','pg_temp'
as $$
begin
  if tg_op='INSERT' and new.amount<=0 then raise exception 'Expense amount must be positive'; end if;
  if tg_op='UPDATE' and old.amount>0 and new.amount<=0 then raise exception 'Expense amount must be positive'; end if;
  if new.approval_status='approved' and (new.approved_by is null or new.approved_at is null) then raise exception 'Approved expense requires approval metadata'; end if;
  if new.approval_status='rejected' and nullif(trim(coalesce(new.rejection_reason,'')),'') is null then raise exception 'Rejected expense requires reason'; end if;
  return new;
end;
$$;
drop trigger if exists trg_finance_expense_validate on public.finance_cost_items;
create trigger trg_finance_expense_validate
before insert or update on public.finance_cost_items
for each row execute function public.finance_expense_validate_amount();

create table if not exists public.petty_cash_ledger (
  id uuid primary key default extensions.uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(18,2) not null check(amount>0),
  direction text not null check(direction=any(array['allocated'::text,'spent'::text,'returned'::text])),
  related_expense_id uuid null references public.finance_cost_items(id) on delete set null,
  description text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint petty_cash_ledger_tenant_unique unique(id,organization_id),
  constraint petty_cash_user_tenant_fk foreign key(user_id,organization_id) references public.profiles(id,organization_id),
  constraint petty_cash_creator_tenant_fk foreign key(created_by,organization_id) references public.profiles(id,organization_id)
);
alter table public.petty_cash_ledger enable row level security;

drop policy if exists petty_cash_select on public.petty_cash_ledger;
create policy petty_cash_select on public.petty_cash_ledger for select to authenticated
using(organization_id=(select public.user_org_id()) and ((select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role) or user_id=(select auth.uid())));
drop policy if exists petty_cash_insert on public.petty_cash_ledger;
create policy petty_cash_insert on public.petty_cash_ledger for insert to authenticated with check(false);
drop policy if exists petty_cash_no_update on public.petty_cash_ledger;
create policy petty_cash_no_update on public.petty_cash_ledger for update to authenticated using(false) with check(false);
drop policy if exists petty_cash_no_delete on public.petty_cash_ledger;
create policy petty_cash_no_delete on public.petty_cash_ledger for delete to authenticated using(false);

create or replace function public.record_petty_cash_entry(
  p_user_id uuid,p_amount numeric,p_direction text,p_related_expense_id uuid default null,p_description text default null)
returns public.petty_cash_ledger language plpgsql security definer set search_path=''
as $$
declare v public.petty_cash_ledger; available numeric;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if public.user_org_id() is null then raise exception 'Organization not found'; end if;
  if p_amount<=0 then raise exception 'Amount must be positive'; end if;
  if p_direction not in ('allocated','spent','returned') then raise exception 'Invalid petty cash direction'; end if;
  if p_direction='allocated' and public.user_role() not in ('owner'::public.user_role,'admin'::public.user_role) then raise exception 'Only owner/admin can allocate petty cash'; end if;
  if p_direction in ('spent','returned') and p_user_id<>(select auth.uid()) and public.user_role() not in ('owner'::public.user_role,'admin'::public.user_role) then raise exception 'You can only record your own petty cash'; end if;
  if p_direction in ('spent','returned') then
    select coalesce(sum(case when direction='allocated' then amount else -amount end),0)
    into available from public.petty_cash_ledger
    where organization_id=public.user_org_id() and user_id=p_user_id;
    if available<p_amount then raise exception 'Insufficient petty cash balance'; end if;
  end if;
  if p_related_expense_id is not null and not exists(
    select 1 from public.finance_cost_items e
    where e.id=p_related_expense_id and e.organization_id=public.user_org_id()
      and (e.created_by=(select auth.uid()) or public.user_role() in ('owner'::public.user_role,'admin'::public.user_role))
  ) then raise exception 'Expense not authorized'; end if;
  insert into public.petty_cash_ledger(organization_id,user_id,amount,direction,related_expense_id,description,created_by)
  values(public.user_org_id(),p_user_id,p_amount,p_direction,p_related_expense_id,p_description,(select auth.uid()))
  returning * into v;
  return v;
end;
$$;
revoke all on function public.record_petty_cash_entry(uuid,numeric,text,uuid,text) from public;
grant execute on function public.record_petty_cash_entry(uuid,numeric,text,uuid,text) to authenticated;

create table if not exists public.financial_permissions (
  id uuid primary key default extensions.uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  view_own_expenses boolean not null default true,
  view_own_petty_cash boolean not null default true,
  view_own_receipts boolean not null default true,
  approve_other_expenses boolean not null default false,
  issue_payment_request boolean not null default false,
  view_org_financials boolean not null default false,
  view_profit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_permissions_unique_user unique(organization_id,user_id),
  constraint financial_permissions_user_tenant_fk foreign key(user_id,organization_id) references public.profiles(id,organization_id)
);
alter table public.financial_permissions enable row level security;

create or replace function private.finance_has_permission(p_permission text)
returns boolean language sql stable security definer set search_path=''
as $$
  select coalesce((select (to_jsonb(fp)->>p_permission)::boolean
    from public.financial_permissions fp
    where fp.organization_id=public.user_org_id() and fp.user_id=(select auth.uid())),false);
$$;
revoke all on function private.finance_has_permission(text) from public;
grant usage on schema private to authenticated;
grant execute on function private.finance_has_permission(text) to authenticated;

drop policy if exists financial_permissions_select on public.financial_permissions;
create policy financial_permissions_select on public.financial_permissions for select to authenticated
using(organization_id=(select public.user_org_id()) and (user_id=(select auth.uid()) or (select public.user_role())='owner'::public.user_role));
drop policy if exists financial_permissions_insert on public.financial_permissions;
create policy financial_permissions_insert on public.financial_permissions for insert to authenticated
with check(organization_id=(select public.user_org_id()) and (select public.user_role())='owner'::public.user_role);
drop policy if exists financial_permissions_update on public.financial_permissions;
create policy financial_permissions_update on public.financial_permissions for update to authenticated
using(organization_id=(select public.user_org_id()) and (select public.user_role())='owner'::public.user_role)
with check(organization_id=(select public.user_org_id()) and (select public.user_role())='owner'::public.user_role);
drop policy if exists financial_permissions_delete on public.financial_permissions;
create policy financial_permissions_delete on public.financial_permissions for delete to authenticated
using(organization_id=(select public.user_org_id()) and (select public.user_role())='owner'::public.user_role);

insert into public.financial_permissions(organization_id,user_id,approve_other_expenses,issue_payment_request,view_org_financials,view_profit)
select p.organization_id,p.id,p.role in ('owner','admin'),p.role in ('owner','admin'),p.role='owner',p.role='owner'
from public.profiles p on conflict(organization_id,user_id) do nothing;

create or replace function public.ensure_financial_permission_row() returns trigger
language plpgsql security definer set search_path='public','pg_catalog','pg_temp'
as $$
begin
 insert into public.financial_permissions(organization_id,user_id,approve_other_expenses,issue_payment_request,view_org_financials,view_profit)
 values(new.organization_id,new.id,new.role in ('owner','admin'),new.role in ('owner','admin'),new.role='owner',new.role='owner')
 on conflict(organization_id,user_id) do nothing;
 return new;
end;
$$;
drop trigger if exists trg_profile_financial_permissions on public.profiles;
create trigger trg_profile_financial_permissions after insert on public.profiles
for each row execute function public.ensure_financial_permission_row();

drop policy if exists finance_ci_select on public.finance_cost_items;
create policy finance_ci_select on public.finance_cost_items for select to authenticated
using(organization_id=(select public.user_org_id()) and (
 (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
 or created_by=(select auth.uid())
 or ((select private.finance_has_permission('approve_other_expenses')) and approval_status='pending')
));
drop policy if exists finance_ci_insert on public.finance_cost_items;
create policy finance_ci_insert on public.finance_cost_items for insert to authenticated
with check(
 organization_id=(select public.user_org_id())
 and created_by=(select auth.uid())
 and approval_status='pending'
 and (
  (select public.user_role()) <> 'client'::public.user_role
  or client_id=(select public.user_client_id())
 )
);
drop policy if exists finance_ci_update on public.finance_cost_items;
create policy finance_ci_update on public.finance_cost_items for update to authenticated
using(organization_id=(select public.user_org_id()) and (
 (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
 or (created_by=(select auth.uid()) and approval_status='pending')
))
with check(organization_id=(select public.user_org_id()) and (
 (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
 or (created_by=(select auth.uid()) and approval_status='pending' and approved_by is null and approved_at is null and rejection_reason is null)
));
drop policy if exists finance_ci_delete on public.finance_cost_items;
create policy finance_ci_delete on public.finance_cost_items for delete to authenticated
using(organization_id=(select public.user_org_id()) and (
 (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
 or (created_by=(select auth.uid()) and approval_status='pending')
));

create or replace function public.approve_finance_expense(p_expense_id uuid,p_approve boolean,p_rejection_reason text default null)
returns public.finance_cost_items language plpgsql security definer set search_path=''
as $$
declare v public.finance_cost_items;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 if public.user_org_id() is null then raise exception 'Organization not found'; end if;
 if public.user_role() not in ('owner'::public.user_role,'admin'::public.user_role)
    and not private.finance_has_permission('approve_other_expenses') then raise exception 'Expense approval permission required'; end if;
 if not exists(select 1 from public.finance_cost_items e where e.id=p_expense_id and e.organization_id=public.user_org_id() and e.approval_status='pending') then raise exception 'Expense not found or already decided'; end if;
 if exists(select 1 from public.finance_cost_items e where e.id=p_expense_id and e.organization_id=public.user_org_id() and e.created_by=(select auth.uid())) then raise exception 'Expense creator cannot approve or reject their own expense'; end if;
 if not p_approve and nullif(trim(coalesce(p_rejection_reason,'')),'') is null then raise exception 'Rejection reason is required'; end if;
 update public.finance_cost_items set
   approval_status=case when p_approve then 'approved' else 'rejected' end,
   status=case when p_approve then 'confirmed' else 'cancelled' end,
   approved_by=case when p_approve then (select auth.uid()) else null end,
   approved_at=case when p_approve then now() else null end,
   rejection_reason=case when p_approve then null else trim(p_rejection_reason) end,
   updated_by=(select auth.uid()),updated_at=now()
 where id=p_expense_id and organization_id=public.user_org_id() and approval_status='pending'
 returning * into v;
 if not found then raise exception 'Expense not found or already decided'; end if;
 return v;
end;
$$;
revoke all on function public.approve_finance_expense(uuid,boolean,text) from public;
grant execute on function public.approve_finance_expense(uuid,boolean,text) to authenticated;

alter table public.finance_payment_requests add column if not exists trigger_point text not null default 'mid_process';
alter table public.finance_payment_requests drop constraint if exists finance_payment_requests_status_check;
alter table public.finance_payment_requests add constraint finance_payment_requests_status_check
check(status=any(array['draft'::text,'sent'::text,'paid'::text,'partially_paid'::text,'issued'::text,'cancelled'::text]));
alter table public.finance_payment_requests drop constraint if exists finance_payment_requests_trigger_point_check;
alter table public.finance_payment_requests add constraint finance_payment_requests_trigger_point_check
check(trigger_point=any(array['at_registration'::text,'mid_process'::text,'final_settlement'::text]));

drop policy if exists finance_pr_insert on public.finance_payment_requests;
create policy finance_pr_insert on public.finance_payment_requests for insert to authenticated
with check(organization_id=(select public.user_org_id()) and ((select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role) or private.finance_has_permission('issue_payment_request')));
drop policy if exists finance_pr_update on public.finance_payment_requests;
create policy finance_pr_update on public.finance_payment_requests for update to authenticated
using(organization_id=(select public.user_org_id()) and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role))
with check(organization_id=(select public.user_org_id()) and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role));

alter table public.voucher_line_items add column if not exists source_cost_item_id uuid null;
do $
begin
 if not exists(select 1 from pg_constraint where conrelid='public.voucher_line_items'::regclass and conname='uq_voucher_line_tenant') then
   alter table public.voucher_line_items add constraint uq_voucher_line_tenant unique(id,organization_id);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.voucher_line_items'::regclass and conname='fk_voucher_line_source_cost_tenant') then
   alter table public.voucher_line_items add constraint fk_voucher_line_source_cost_tenant
   foreign key(source_cost_item_id,organization_id) references public.finance_cost_items(id,organization_id) on delete restrict;
 end if;
end $;
create index if not exists idx_voucher_line_source_cost on public.voucher_line_items(organization_id,source_cost_item_id) where source_cost_item_id is not null;

create table if not exists public.voucher_line_profit (
 id uuid primary key default extensions.uuid_generate_v4(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 voucher_line_item_id uuid not null,
 profit_type text not null check(profit_type=any(array['full_line'::text,'partial_amount'::text])),
 profit_amount numeric(18,2) not null check(profit_amount>=0),
 set_by_user_id uuid not null,
 visible_to text not null default 'owner_only' check(visible_to=any(array['owner_only'::text,'owner_and_admin'::text])),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint voucher_line_profit_unique unique(voucher_line_item_id),
 constraint voucher_line_profit_line_fk foreign key(voucher_line_item_id,organization_id) references public.voucher_line_items(id,organization_id) on delete restrict,
 constraint voucher_line_profit_user_fk foreign key(set_by_user_id,organization_id) references public.profiles(id,organization_id)
);
alter table public.voucher_line_profit enable row level security;
create or replace function public.validate_voucher_line_profit() returns trigger
language plpgsql security definer set search_path='public','pg_catalog','pg_temp' as $$
declare d numeric;c numeric;row_total numeric;
begin
 if public.user_role() not in ('owner'::public.user_role,'admin'::public.user_role) then raise exception 'Only owner/admin can manage profit'; end if;
 select coalesce(debit_amount,0),coalesce(credit_amount,0) into d,c from public.voucher_line_items
 where id=new.voucher_line_item_id and organization_id=new.organization_id and status='active';
 if not found then raise exception 'Voucher line not found or is voided'; end if;
 row_total:=greatest(d,c);
 if new.profit_type='full_line' then new.profit_amount:=row_total;
 elsif new.profit_amount>row_total then raise exception 'Profit exceeds voucher line amount'; end if;
 return new;
end;$$;
drop trigger if exists trg_validate_voucher_line_profit on public.voucher_line_profit;
create trigger trg_validate_voucher_line_profit before insert or update on public.voucher_line_profit
for each row execute function public.validate_voucher_line_profit();
drop policy if exists voucher_profit_select on public.voucher_line_profit;
create policy voucher_profit_select on public.voucher_line_profit for select to authenticated using(
 organization_id=(select public.user_org_id()) and private.finance_has_permission('view_profit') and (
  (visible_to='owner_only' and (select public.user_role())='owner'::public.user_role)
  or (visible_to='owner_and_admin' and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role))
 ));
drop policy if exists voucher_profit_insert on public.voucher_line_profit;
create policy voucher_profit_insert on public.voucher_line_profit for insert to authenticated with check(
 organization_id=(select public.user_org_id()) and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
 and set_by_user_id=(select auth.uid())
);
drop policy if exists voucher_profit_update on public.voucher_line_profit;
create policy voucher_profit_update on public.voucher_line_profit for update to authenticated using(
 organization_id=(select public.user_org_id()) and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
) with check(
 organization_id=(select public.user_org_id()) and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
 and set_by_user_id=(select auth.uid())
);
drop policy if exists voucher_profit_delete on public.voucher_line_profit;
create policy voucher_profit_delete on public.voucher_line_profit for delete to authenticated using(
 organization_id=(select public.user_org_id()) and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
);

create or replace function public.finance_organization_summary() returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v jsonb;
begin
 if public.user_org_id() is null then raise exception 'Organization not found'; end if;
 if public.user_role() not in ('owner'::public.user_role,'admin'::public.user_role)
    and not private.finance_has_permission('view_org_financials') then raise exception 'Organization financial summary permission required'; end if;
 select jsonb_build_object(
  'approved_company_expenses_irr',coalesce(sum(case when approval_status='approved' and paid_by='our_company' then amount_irr+vat_amount else 0 end),0),
  'approved_client_direct_irr',coalesce(sum(case when approval_status='approved' and paid_by='client_direct' then amount_irr+vat_amount else 0 end),0),
  'pending_expenses',count(*) filter(where approval_status='pending'),
  'rejected_expenses',count(*) filter(where approval_status='rejected'),
  'expense_count',count(*)
 ) into v from public.finance_cost_items where organization_id=public.user_org_id();
 return v;
end;$$;
revoke all on function public.finance_organization_summary() from public;
grant execute on function public.finance_organization_summary() to authenticated;

drop trigger if exists tr_finance_cost_audit on public.finance_cost_items;
create trigger tr_finance_cost_audit after insert or update or delete on public.finance_cost_items for each row execute function public.record_audit_event();
drop trigger if exists tr_petty_cash_audit on public.petty_cash_ledger;
create trigger tr_petty_cash_audit after insert on public.petty_cash_ledger for each row execute function public.record_audit_event();
drop trigger if exists tr_financial_permissions_audit on public.financial_permissions;
create trigger tr_financial_permissions_audit after insert or update or delete on public.financial_permissions for each row execute function public.record_audit_event();
drop trigger if exists tr_voucher_profit_audit on public.voucher_line_profit;
create trigger tr_voucher_profit_audit after insert or update or delete on public.voucher_line_profit for each row execute function public.record_audit_event();

insert into storage.buckets(id,name,public,allowed_mime_types)
values('finance-receipts','finance-receipts',false,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do nothing;

drop policy if exists finance_receipts_insert on storage.objects;
create policy finance_receipts_insert on storage.objects for insert to authenticated
with check(bucket_id='finance-receipts' and (storage.foldername(name))[1]=(select public.user_org_id())::text and (storage.foldername(name))[2]=(select auth.uid())::text);
drop policy if exists finance_receipts_select on storage.objects;
create policy finance_receipts_select on storage.objects for select to authenticated
using(bucket_id='finance-receipts' and (storage.foldername(name))[1]=(select public.user_org_id())::text and
 ((storage.foldername(name))[2]=(select auth.uid())::text or (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)));
drop policy if exists finance_receipts_delete on storage.objects;
create policy finance_receipts_delete on storage.objects for delete to authenticated
using(bucket_id='finance-receipts' and (storage.foldername(name))[1]=(select public.user_org_id())::text and (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role));

-- ---- Hardening patch: permission-aware reads, secure request-position aggregate, voucher source uniqueness ----
drop policy if exists finance_ci_select on public.finance_cost_items;
create policy finance_ci_select on public.finance_cost_items for select to authenticated
using (
  organization_id=(select public.user_org_id()) and (
    (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
    or (created_by=(select auth.uid()) and (select private.finance_has_permission('view_own_expenses')))
    or ((select private.finance_has_permission('approve_other_expenses')) and approval_status='pending')
  )
);

drop policy if exists petty_cash_select on public.petty_cash_ledger;
create policy petty_cash_select on public.petty_cash_ledger for select to authenticated
using (
  organization_id=(select public.user_org_id()) and (
    (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
    or (user_id=(select auth.uid()) and (select private.finance_has_permission('view_own_petty_cash')))
  )
);

drop policy if exists finance_pay_select on public.finance_payments;
create policy finance_pay_select on public.finance_payments for select to authenticated
using (
  organization_id=(select public.user_org_id()) and (
    (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
    or (select private.finance_has_permission('view_org_financials'))
    or (created_by=(select auth.uid()) and (select private.finance_has_permission('view_own_receipts')))
    or ((select public.user_role())='client'::public.user_role and client_id=(select public.user_client_id()))
  )
);

drop policy if exists finance_receipts_select on storage.objects;
create policy finance_receipts_select on storage.objects for select to authenticated
using (
  bucket_id='finance-receipts'
  and (storage.foldername(name))[1]=(select public.user_org_id())::text
  and (
    ((storage.foldername(name))[2]=(select auth.uid())::text and (select private.finance_has_permission('view_own_receipts')))
    or (select public.user_role()) in ('owner'::public.user_role,'admin'::public.user_role)
    or (select private.finance_has_permission('view_org_financials'))
  )
);

create unique index if not exists uq_active_voucher_line_source_cost
on public.voucher_line_items(organization_id,source_cost_item_id)
where source_cost_item_id is not null and status='active';

create or replace function public.finance_shipment_position(p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public','pg_catalog','pg_temp'
as $$
declare
  v_org uuid := public.user_org_id();
  v_case uuid;
  v_company numeric := 0;
  v_client_direct numeric := 0;
  v_received numeric := 0;
  v_profit numeric := 0;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if v_org is null then raise exception 'Organization not found'; end if;
  if public.user_role() not in ('owner'::public.user_role,'admin'::public.user_role)
     and not private.finance_has_permission('issue_payment_request')
     and not private.finance_has_permission('view_org_financials')
  then raise exception 'Finance position permission required'; end if;

  select s.case_id into v_case from public.shipments s
  where s.id=p_shipment_id and s.organization_id=v_org;
  if v_case is null then raise exception 'Shipment not found'; end if;

  select coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)),0) into v_company
  from public.finance_cost_items e
  where e.organization_id=v_org and e.shipment_id=p_shipment_id
    and e.approval_status='approved' and e.paid_by='our_company'
    and coalesce(e.billable,false)=true and e.status<>'cancelled';

  select coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)),0) into v_client_direct
  from public.finance_cost_items e
  where e.organization_id=v_org and e.shipment_id=p_shipment_id
    and e.approval_status='approved' and e.paid_by='client_direct' and e.status<>'cancelled';

  select coalesce(sum(p.amount_irr),0) into v_received
  from public.finance_payments p
  where p.organization_id=v_org and p.shipment_id=p_shipment_id and p.direction='received';

  select coalesce(sum(pl.profit_amount),0) into v_profit
  from public.voucher_line_profit pl
  join public.voucher_line_items li on li.id=pl.voucher_line_item_id and li.organization_id=v_org and li.status='active'
  join public.customs_accounting_vouchers v on v.id=li.voucher_id and v.organization_id=v_org
  where pl.organization_id=v_org and v.case_id=v_case;

  return jsonb_build_object(
    'shipment_id',p_shipment_id,
    'case_id',v_case,
    'our_company_cost_irr',v_company,
    'client_direct_cost_irr',v_client_direct,
    'profit_irr',case when public.user_role()='owner'::public.user_role or private.finance_has_permission('view_profit') then v_profit else null end,
    'received_irr',v_received,
    'outstanding_irr',greatest(0,v_company+v_profit-v_received)
  );
end;
$$;
revoke all on function public.finance_shipment_position(uuid) from public;
grant execute on function public.finance_shipment_position(uuid) to authenticated;
revoke execute on function public.approve_finance_expense(uuid,boolean,text) from anon, public;
grant execute on function public.approve_finance_expense(uuid,boolean,text) to authenticated;
revoke execute on function public.record_petty_cash_entry(uuid,numeric,text,uuid,text) from anon, public;
grant execute on function public.record_petty_cash_entry(uuid,numeric,text,uuid,text) to authenticated;
revoke execute on function public.finance_organization_summary() from anon, public;
grant execute on function public.finance_organization_summary() to authenticated;
revoke execute on function public.finance_shipment_position(uuid) from anon, public;
grant execute on function public.finance_shipment_position(uuid) to authenticated;
revoke execute on function public.finance_expense_validate_amount() from anon, authenticated, public, service_role;
revoke execute on function public.validate_voucher_line_profit() from anon, authenticated, public, service_role;

