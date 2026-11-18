-- Present legacy registration-order references as review candidates only.
-- Do not silently attach old shipments or count them against a master order's capacity.
-- Explicit shipment FK and existing case-based relationships remain authoritative.

create or replace function public.normalize_registration_order_reference(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select nullif(regexp_replace(
    translate(upper(trim(coalesce(p_value,''))),
      '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789'),
    '\s+','','g'),'');
$$;

create or replace function public.registration_order_legacy_candidate_id(
  p_shipment_id uuid,
  p_customs_order_number text
)
returns uuid
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
  v_client uuid;
  v_direct_order_id uuid;
  v_order_key text;
  v_matches uuid[];
begin
  v_order_key:=public.normalize_registration_order_reference(p_customs_order_number);
  if v_order_key is null then return null; end if;

  select organization_id,client_id,registration_order_id into v_org,v_client,v_direct_order_id
  from public.shipments where id=p_shipment_id;
  if not found or v_direct_order_id is not null then return null; end if;

  select array_agg(ro.id order by ro.id)
    into v_matches
  from public.registration_orders ro
  where ro.organization_id=v_org
    and ro.client_id is not distinct from v_client
    and public.normalize_registration_order_reference(ro.order_number)=v_order_key;

  if coalesce(cardinality(v_matches),0)<>1 then return null; end if;
  return v_matches[1];
end;
$$;

create or replace view public.registration_order_legacy_match_candidates
with (security_invoker=true) as
select
  ro.id as registration_order_id,
  ro.organization_id,
  ro.order_number,
  ro.client_id as registration_order_client_id,
  s.id as shipment_id,
  s.client_id as shipment_client_id,
  s.display_name as shipment_name,
  s.bill_of_lading_no,
  d.registration_order_no as customs_registration_order_no,
  coalesce(d.net_weight_kg,s.net_weight_kg) as candidate_net_weight_kg,
  coalesce(d.gross_weight_kg,s.gross_weight_kg) as candidate_gross_weight_kg,
  d.invoice_amount as candidate_invoice_amount,
  d.invoice_currency as candidate_invoice_currency,
  'shipment_customs_data.registration_order_no'::text as candidate_source
from public.shipments s
join public.shipment_customs_data d
  on d.shipment_id=s.id and d.organization_id=s.organization_id
join public.registration_orders ro
  on ro.id=public.registration_order_legacy_candidate_id(s.id,d.registration_order_no)
 and ro.organization_id=s.organization_id
where s.registration_order_id is null
  -- Already-linked-by-case records are not presented as unresolved candidates.
  and not (ro.case_id is not null and s.case_id=ro.case_id)
  and not exists (
    select 1
    from public.cases c
    where c.id=s.case_id
      and c.organization_id=s.organization_id
      and nullif(public.normalize_registration_order_reference(c.registration_order_no),'') is not null
      and public.normalize_registration_order_reference(c.registration_order_no)
          <> public.normalize_registration_order_reference(ro.order_number)
  )
  and not exists (
    select 1
    from public.cases c
    where c.id=s.case_id
      and c.organization_id=s.organization_id
      and public.normalize_registration_order_reference(c.registration_order_no)
          = public.normalize_registration_order_reference(ro.order_number)
  );

grant select on public.registration_order_legacy_match_candidates to authenticated;
