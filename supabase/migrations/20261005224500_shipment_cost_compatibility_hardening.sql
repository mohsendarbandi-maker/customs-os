-- Compatibility hardening for existing finance APIs and permission defaults.

create or replace function public.create_finance_expense(
 p_shipment_id uuid,p_client_id uuid,p_category_id uuid,p_description text,p_amount numeric,
 p_currency text,p_exchange_rate numeric default 1,p_paid_by text default null,p_notes text default null,
 p_receipt_file_url text default null
)
returns public.finance_cost_items language plpgsql security definer set search_path=''
as $$
declare v public.finance_cost_items;v_org uuid;v_user uuid;v_role public.user_role;v_vat numeric:=0;v_threshold numeric:=0;v_amount_irr numeric;v_category_name text;
begin
 v_user:=auth.uid();if v_user is null then raise exception 'نشست کاربر معتبر نیست.';end if;
 v_org:=public.user_org_id();if v_org is null then raise exception 'سازمان کاربر پیدا نشد.';end if;v_role:=public.user_role();
 if p_amount is null or p_amount<=0 then raise exception 'مبلغ باید بیشتر از صفر باشد.';end if;
 if coalesce(p_exchange_rate,0)<=0 then raise exception 'نرخ تبدیل باید بیشتر از صفر باشد.';end if;
 if p_paid_by not in ('our_company','client_direct') then raise exception 'منبع پرداخت الزامی و نامعتبر است.';end if;
 if nullif(trim(coalesce(p_description,'')),'') is null then raise exception 'شرح هزینه الزامی است.';end if;
 if not exists(select 1 from public.clients c where c.id=p_client_id and c.organization_id=v_org) then raise exception 'صاحب کالا برای این سازمان معتبر نیست.';end if;
 if not exists(select 1 from public.shipments s where s.id=p_shipment_id and s.organization_id=v_org and s.client_id=p_client_id) then raise exception 'محموله انتخاب‌شده متعلق به صاحب کالا/سازمان نیست.';end if;
 select c.name_fa into v_category_name from public.finance_cost_categories c where c.id=p_category_id and c.organization_id=v_org and c.is_active=true;
 if v_category_name is null then raise exception 'دسته هزینه معتبر یا فعال نیست.';end if;
 if v_role='client'::public.user_role and public.user_client_id() is distinct from p_client_id then raise exception 'صاحب کالا مجاز به ثبت هزینه برای این Client نیست.';end if;
 if p_receipt_file_url is not null and not exists(select 1 from storage.objects o where o.bucket_id='finance-receipts' and o.name=p_receipt_file_url and (storage.foldername(o.name))[1]=v_org::text and (storage.foldername(o.name))[2]=v_user::text) then raise exception 'فایل فیش در Storage قابل تأیید نیست.';end if;
 select coalesce(default_vat_rate,0),coalesce(receipt_mandatory_threshold_irr,0) into v_vat,v_threshold from public.finance_org_settings where organization_id=v_org;
 v_amount_irr:=round(p_amount*p_exchange_rate,2);if v_amount_irr>v_threshold and p_receipt_file_url is null then raise exception 'برای این مبلغ، فیش پرداختی الزامی است.';end if;
 insert into public.finance_cost_items(organization_id,shipment_id,case_id,client_id,category_id,cost_type,cost_category,description,quantity,unit,unit_price,amount,currency,exchange_rate,amount_irr,vat_rate,vat_amount,payable_by,billable,reimbursable,status,occurred_at,payment_date,notes,created_by,updated_by,uploaded_by,paid_by,approval_status,workflow_status,receipt_files,receipt_file_url)
 select v_org,s.id,s.case_id,p_client_id,p_category_id,'MISC',v_category_name,trim(p_description),1,'هزینه',p_amount,p_amount,p_currency::public.currency_code,p_exchange_rate,v_amount_irr,v_vat,round(v_amount_irr*v_vat/100,2),'client',p_paid_by='our_company',false,false,'draft',now(),current_date,nullif(trim(coalesce(p_notes,'')),''),v_user,v_user,v_user,p_paid_by,'pending','SUBMITTED','[]'::jsonb,p_receipt_file_url
 from public.shipments s where s.id=p_shipment_id and s.organization_id=v_org and s.client_id=p_client_id returning * into v;
 if not found then raise exception 'ثبت هزینه انجام نشد.';end if;return v;
end;
$$;
revoke all on function public.create_finance_expense(uuid,uuid,uuid,text,numeric,text,numeric,text,text,text) from public,anon;
grant execute on function public.create_finance_expense(uuid,uuid,uuid,text,numeric,text,numeric,text,text,text) to authenticated;

create or replace function public.ensure_financial_permission_row()
returns trigger language plpgsql security definer set search_path='public','pg_catalog','pg_temp'
as $$
begin
 insert into public.financial_permissions(organization_id,user_id,approve_other_expenses,issue_payment_request,view_org_financials,view_profit)
 values(new.organization_id,new.id,new.role in ('owner','admin'),new.role in ('owner','admin'),new.role in ('owner','admin','accountant'),new.role='owner')
 on conflict(organization_id,user_id) do nothing;
 return new;
end;
$$;
revoke all on function public.ensure_financial_permission_row() from public,anon,authenticated;

update public.financial_permissions fp
set view_org_financials=true,updated_at=now()
from public.profiles p
where p.id=fp.user_id and p.organization_id=fp.organization_id
  and p.role in ('owner'::public.user_role,'admin'::public.user_role,'accountant'::public.user_role);

create or replace function public.finance_organization_summary()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v jsonb;
begin
 if public.user_org_id() is null then raise exception 'Organization not found';end if;
 if public.user_role() not in ('owner'::public.user_role,'admin'::public.user_role,'accountant'::public.user_role)
    and not private.finance_has_permission('view_org_financials') then raise exception 'Organization financial summary permission required';end if;
 select jsonb_build_object(
  'approved_company_expenses_irr',coalesce(sum(case when approval_status='approved' and paid_by='our_company' then amount_irr+coalesce(vat_amount,0) else 0 end),0),
  'approved_client_direct_irr',coalesce(sum(case when approval_status='approved' and paid_by='client_direct' then amount_irr+coalesce(vat_amount,0) else 0 end),0),
  'pending_expenses',count(*) filter(where approval_status='pending'),
  'rejected_expenses',count(*) filter(where approval_status='rejected'),
  'expense_count',count(*)
 ) into v from public.finance_cost_items where organization_id=public.user_org_id() and deleted_at is null;
 return v;
end;
$$;
revoke all on function public.finance_organization_summary() from public,anon;
grant execute on function public.finance_organization_summary() to authenticated;

create or replace function public.finance_shipment_position(p_shipment_id uuid)
returns jsonb language plpgsql security definer set search_path='public','pg_catalog','pg_temp'
as $$
declare v_org uuid:=public.user_org_id();v_case uuid;v_company numeric:=0;v_client_direct numeric:=0;v_received numeric:=0;v_profit numeric:=0;
begin
 if auth.uid() is null or v_org is null then raise exception 'Authentication required';end if;
 if public.user_role() not in ('owner'::public.user_role,'admin'::public.user_role,'accountant'::public.user_role)
    and not private.finance_has_permission('issue_payment_request')
    and not private.finance_has_permission('view_org_financials') then raise exception 'Finance position permission required';end if;
 select s.case_id into v_case from public.shipments s where s.id=p_shipment_id and s.organization_id=v_org;
 if not found then raise exception 'Shipment not found';end if;
 select coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)),0) into v_company from public.finance_cost_items e where e.organization_id=v_org and e.shipment_id=p_shipment_id and e.workflow_status='APPROVED' and e.paid_by='our_company' and coalesce(e.billable,false)=true and e.deleted_at is null and e.status<>'cancelled';
 select coalesce(sum(e.amount_irr+coalesce(e.vat_amount,0)),0) into v_client_direct from public.finance_cost_items e where e.organization_id=v_org and e.shipment_id=p_shipment_id and e.workflow_status='APPROVED' and e.paid_by='client_direct' and e.deleted_at is null and e.status<>'cancelled';
 select coalesce(sum(p.amount_irr),0) into v_received from public.finance_payments p where p.organization_id=v_org and p.shipment_id=p_shipment_id and p.direction='received';
 select coalesce(sum(pl.profit_amount),0) into v_profit from public.voucher_line_profit pl join public.voucher_line_items li on li.id=pl.voucher_line_item_id and li.organization_id=v_org and li.status='active' join public.customs_accounting_vouchers v on v.id=li.voucher_id and v.organization_id=v_org where pl.organization_id=v_org and v.case_id=v_case;
 return jsonb_build_object('shipment_id',p_shipment_id,'case_id',v_case,'our_company_cost_irr',v_company,'client_direct_cost_irr',v_client_direct,'profit_irr',case when public.user_role()='owner'::public.user_role or private.finance_has_permission('view_profit') then v_profit else null end,'received_irr',v_received,'outstanding_irr',greatest(0,v_company+case when public.user_role()='owner'::public.user_role or private.finance_has_permission('view_profit') then v_profit else 0 end-v_received));
end;
$$;
revoke all on function public.finance_shipment_position(uuid) from public,anon;
grant execute on function public.finance_shipment_position(uuid) to authenticated;
