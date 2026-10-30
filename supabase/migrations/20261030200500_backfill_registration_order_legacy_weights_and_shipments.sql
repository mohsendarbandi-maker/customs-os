alter table public.registration_orders disable trigger tr_registration_order_tenant_client;

update public.registration_orders ro
set net_weight_kg=coalesce(ro.net_weight_kg,c.net_weight_kg),
    gross_weight_kg=coalesce(ro.gross_weight_kg,c.gross_weight_kg)
from public.cases c
where c.id=ro.case_id and c.organization_id=ro.organization_id
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
      where shipment_case.id=s.case_id
        and shipment_case.organization_id=s.organization_id
        and shipment_case.registration_order_no=ro.order_number
    )
  );