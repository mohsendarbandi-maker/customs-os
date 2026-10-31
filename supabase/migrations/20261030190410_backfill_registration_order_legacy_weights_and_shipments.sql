alter table public.registration_orders disable trigger tr_registration_order_tenant_client;

with shipment_totals as (
 select ro.id as registration_order_id,
        sum(coalesce(d.net_weight_kg,s.net_weight_kg)) as net_weight_kg,
        sum(coalesce(d.gross_weight_kg,s.gross_weight_kg)) as gross_weight_kg
 from public.registration_orders ro
 left join public.cases master_case
   on master_case.id=ro.case_id and master_case.organization_id=ro.organization_id
 left join public.shipments s
   on s.organization_id=ro.organization_id
  and (s.registration_order_id=ro.id or s.case_id=master_case.id or exists (
    select 1 from public.cases shipment_case
    where shipment_case.id=s.case_id and shipment_case.organization_id=s.organization_id
      and shipment_case.registration_order_no=ro.order_number
  ))
 left join public.shipment_customs_data d on d.shipment_id=s.id
 group by ro.id
)
update public.registration_orders ro
set net_weight_kg=coalesce(ro.net_weight_kg,st.net_weight_kg),
    gross_weight_kg=coalesce(ro.gross_weight_kg,st.gross_weight_kg)
from shipment_totals st
where ro.id=st.registration_order_id
  and (ro.net_weight_kg is null or ro.gross_weight_kg is null);

alter table public.registration_orders enable trigger tr_registration_order_tenant_client;

update public.shipments s
set registration_order_id=ro.id
from public.registration_orders ro
left join public.cases master_case
  on master_case.id=ro.case_id and master_case.organization_id=ro.organization_id
where s.organization_id=ro.organization_id
  and s.registration_order_id is null
  and (
    (master_case.id is not null and s.case_id=master_case.id)
    or exists (
      select 1 from public.cases shipment_case
      where shipment_case.id=s.case_id and shipment_case.organization_id=s.organization_id
        and shipment_case.registration_order_no=ro.order_number
    )
  );