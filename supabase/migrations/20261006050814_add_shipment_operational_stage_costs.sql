alter table public.finance_cost_items
  drop constraint if exists finance_cost_items_cost_type_check;

alter table public.finance_cost_items
  add constraint finance_cost_items_cost_type_check check (
    cost_type = any (array[
      'STAGE_1_SHIPMENT','STAGE_2_PRE_DECLARATION','STAGE_3_DECLARATION',
      'STAGE_4_CUSTOMS_OPERATIONS','STAGE_5_EXIT_PREPARATION','STAGE_6_EXIT',
      'PRE_DECLARATION','DURING_DECLARATION','POST_DECLARATION','MISC'
    ])
  );

create or replace function public.create_finance_shipment_cost(
  p_shipment_id uuid,
  p_client_id uuid,
  p_cost_type text,
  p_category_id uuid,
  p_cost_category text,
  p_description text,
  p_amount numeric,
  p_currency text,
  p_exchange_rate numeric default 1,
  p_payment_date date default current_date,
  p_paid_by text default 'our_company',
  p_receipt_files jsonb default '[]'::jsonb,
  p_notes text default null
)
returns public.finance_cost_items
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v public.finance_cost_items;
  v_org uuid := public.user_org_id();
  v_user uuid := auth.uid();
  v_case uuid;
  v_derived_category text;
  v_amount_irr numeric;
begin
  if v_user is null or v_org is null then raise exception 'Authentication required'; end if;
  if public.user_role()='client'::public.user_role then raise exception 'This finance action is not available to client users'; end if;
  if p_cost_type not in (
    'STAGE_1_SHIPMENT','STAGE_2_PRE_DECLARATION','STAGE_3_DECLARATION',
    'STAGE_4_CUSTOMS_OPERATIONS','STAGE_5_EXIT_PREPARATION','STAGE_6_EXIT',
    'PRE_DECLARATION','DURING_DECLARATION','POST_DECLARATION','MISC'
  ) then raise exception 'Invalid cost stage'; end if;
  if p_currency not in ('IRR','USD','EUR') then raise exception 'Only IRR, USD and EUR are supported for shipment costs'; end if;
  if p_paid_by not in ('our_company','client_direct') then raise exception 'Invalid payer'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if coalesce(p_exchange_rate,0) <= 0 then raise exception 'Exchange rate must be greater than zero'; end if;
  if p_payment_date is null then raise exception 'Payment date is required'; end if;
  if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Cost description is required'; end if;
  if pg_catalog.jsonb_typeof(coalesce(p_receipt_files,'[]'::jsonb))<>'array' then raise exception 'receipt_files must be an array'; end if;

  select s.case_id into v_case from public.shipments s
  where s.id=p_shipment_id and s.organization_id=v_org and s.client_id=p_client_id;

  if v_case is null and not exists(
    select 1 from public.shipments s
    where s.id=p_shipment_id and s.organization_id=v_org and s.client_id=p_client_id
  ) then raise exception 'Shipment/client combination is invalid'; end if;

  if not exists(select 1 from public.clients c where c.id=p_client_id and c.organization_id=v_org) then raise exception 'Client is invalid'; end if;
  if not exists(select 1 from public.finance_cost_categories c where c.id=p_category_id and c.organization_id=v_org and c.is_active=true) then raise exception 'Cost category is invalid or inactive'; end if;

  select c.name_fa into v_derived_category from public.finance_cost_categories c
  where c.id=p_category_id and c.organization_id=v_org;

  v_amount_irr := round(p_amount*p_exchange_rate,2);

  insert into public.finance_cost_items(
    organization_id,shipment_id,case_id,client_id,category_id,cost_type,cost_category,description,
    quantity,unit,unit_price,amount,currency,exchange_rate,amount_irr,vat_rate,vat_amount,
    payable_by,billable,reimbursable,status,occurred_at,payment_date,notes,created_by,updated_by,
    uploaded_by,paid_by,approval_status,workflow_status,receipt_files,receipt_file_url
  )
  values(
    v_org,p_shipment_id,v_case,p_client_id,p_category_id,p_cost_type,
    coalesce(nullif(btrim(p_cost_category),''),v_derived_category),btrim(p_description),
    1,'هزینه',p_amount,p_amount,p_currency::public.currency_code,p_exchange_rate,v_amount_irr,
    0,0,'client',p_paid_by='our_company',false,'draft',now(),p_payment_date,
    nullif(btrim(coalesce(p_notes,'')),''),v_user,v_user,v_user,p_paid_by,'pending','DRAFT',
    coalesce(p_receipt_files,'[]'::jsonb),
    case when pg_catalog.jsonb_array_length(coalesce(p_receipt_files,'[]'::jsonb))>0
      then p_receipt_files->0->>'path' else null end
  )
  returning * into v;

  return v;
end;
$function$;