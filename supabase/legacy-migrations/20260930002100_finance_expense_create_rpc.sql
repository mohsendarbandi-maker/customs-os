-- Atomic, session-bound finance expense creation.
create or replace function public.create_finance_expense(
 p_shipment_id uuid,
 p_client_id uuid,
 p_category_id uuid,
 p_description text,
 p_amount numeric,
 p_currency text,
 p_exchange_rate numeric default 1,
 p_paid_by text default null,
 p_notes text default null,
 p_receipt_file_url text default null
)
returns public.finance_cost_items
language plpgsql
security definer
set search_path=''
as $$
declare
 v public.finance_cost_items;
 v_org uuid;
 v_user uuid;
 v_role public.user_role;
 v_vat numeric := 0;
 v_threshold numeric := 0;
 v_amount_irr numeric;
begin
 v_user := auth.uid();
 if v_user is null then raise exception 'نشست کاربر معتبر نیست.'; end if;
 v_org := public.user_org_id();
 if v_org is null then raise exception 'سازمان کاربر پیدا نشد.'; end if;
 v_role := public.user_role();

 if p_amount is null or p_amount <= 0 then raise exception 'مبلغ باید بیشتر از صفر باشد.'; end if;
 if coalesce(p_exchange_rate,0) <= 0 then raise exception 'نرخ تبدیل باید بیشتر از صفر باشد.'; end if;
 if p_paid_by not in ('our_company','client_direct') then raise exception 'منبع پرداخت الزامی و نامعتبر است.'; end if;
 if nullif(trim(coalesce(p_description,'')),'') is null then raise exception 'شرح هزینه الزامی است.'; end if;

 if not exists(select 1 from public.clients c where c.id=p_client_id and c.organization_id=v_org) then
   raise exception 'صاحب کالا برای این سازمان معتبر نیست.';
 end if;

 if not exists(select 1 from public.shipments s where s.id=p_shipment_id and s.organization_id=v_org and s.client_id=p_client_id) then
   raise exception 'محموله انتخاب‌شده متعلق به صاحب کالا/سازمان نیست.';
 end if;

 if not exists(select 1 from public.finance_cost_categories c where c.id=p_category_id and c.organization_id=v_org and c.is_active=true) then
   raise exception 'دسته هزینه معتبر یا فعال نیست.';
 end if;

 if v_role='client'::public.user_role and public.user_client_id() is distinct from p_client_id then
   raise exception 'صاحب کالا مجاز به ثبت هزینه برای این Client نیست.';
 end if;

 if p_receipt_file_url is not null and not exists(
   select 1 from storage.objects o
   where o.bucket_id='finance-receipts'
     and o.name=p_receipt_file_url
     and (storage.foldername(o.name))[1]=v_org::text
     and (storage.foldername(o.name))[2]=v_user::text
 ) then
   raise exception 'فایل فیش در Storage قابل تأیید نیست.';
 end if;

 select coalesce(default_vat_rate,0),coalesce(receipt_mandatory_threshold_irr,0)
 into v_vat,v_threshold
 from public.finance_org_settings
 where organization_id=v_org;

 v_amount_irr := round(p_amount*p_exchange_rate,2);
 if v_amount_irr>v_threshold and p_receipt_file_url is null then
   raise exception 'برای این مبلغ، فیش پرداختی الزامی است.';
 end if;

 insert into public.finance_cost_items(
   organization_id,shipment_id,case_id,client_id,category_id,description,
   quantity,unit,unit_price,amount,currency,exchange_rate,amount_irr,
   vat_rate,vat_amount,payable_by,billable,reimbursable,status,occurred_at,
   notes,created_by,updated_by,paid_by,approval_status,receipt_file_url
 )
 select
   v_org,s.id,s.case_id,p_client_id,p_category_id,trim(p_description),
   1,'ردیف',p_amount,p_amount,p_currency::public.currency_code,p_exchange_rate,v_amount_irr,
   v_vat,round(v_amount_irr*v_vat/100,2),'client',p_paid_by='our_company',false,'draft',now(),
   nullif(trim(coalesce(p_notes,'')),''),v_user,v_user,p_paid_by,'pending',p_receipt_file_url
 from public.shipments s
 where s.id=p_shipment_id and s.organization_id=v_org and s.client_id=p_client_id
 returning * into v;

 if not found then raise exception 'ثبت هزینه انجام نشد.'; end if;
 return v;
end;
$$;

revoke all on function public.create_finance_expense(uuid,uuid,uuid,text,numeric,text,numeric,text,text,text) from public;
grant execute on function public.create_finance_expense(uuid,uuid,uuid,text,numeric,text,numeric,text,text,text) to authenticated;