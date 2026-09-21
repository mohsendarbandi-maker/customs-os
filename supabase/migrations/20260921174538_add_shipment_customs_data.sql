create table if not exists public.shipment_customs_data (
  shipment_id uuid primary key references public.shipments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vessel_type text,
  registration_order_no text,
  registration_order_date_shamsi text,
  package_count numeric,
  warehouse_receipt_no text,
  warehouse_receipt_date_shamsi text,
  cargo_description text,
  origin_country text,
  transaction_country text,
  delivery_term text,
  invoice_amount numeric,
  invoice_currency text,
  bank_branch_code text,
  bank_name text,
  bank_branch text,
  lc_number text,
  duty_rate numeric,
  tariff_code text,
  net_weight_kg numeric,
  gross_weight_kg numeric,
  bill_of_lading text,
  insurance_irr numeric,
  required_documents text,
  source_method text not null default 'manual',
  source_text text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipment_customs_data_org_idx on public.shipment_customs_data(organization_id);

alter table public.shipment_customs_data enable row level security;

drop policy if exists shipment_customs_data_select on public.shipment_customs_data;
create policy shipment_customs_data_select on public.shipment_customs_data for select to authenticated
using (organization_id = user_org_id() and (user_role() <> 'client'::user_role or exists (select 1 from public.shipments s where s.id = shipment_customs_data.shipment_id and s.organization_id = user_org_id() and s.client_id = user_client_id())));

drop policy if exists shipment_customs_data_insert on public.shipment_customs_data;
create policy shipment_customs_data_insert on public.shipment_customs_data for insert to authenticated
with check (organization_id = user_org_id() and (user_role() <> 'client'::user_role or exists (select 1 from public.shipments s where s.id = shipment_customs_data.shipment_id and s.organization_id = user_org_id() and s.client_id = user_client_id())));

drop policy if exists shipment_customs_data_update on public.shipment_customs_data;
create policy shipment_customs_data_update on public.shipment_customs_data for update to authenticated
using (organization_id = user_org_id() and (user_role() <> 'client'::user_role or exists (select 1 from public.shipments s where s.id = shipment_customs_data.shipment_id and s.organization_id = user_org_id() and s.client_id = user_client_id())))
with check (organization_id = user_org_id() and (user_role() <> 'client'::user_role or exists (select 1 from public.shipments s where s.id = shipment_customs_data.shipment_id and s.organization_id = user_org_id() and s.client_id = user_client_id())));

drop policy if exists shipment_customs_data_delete on public.shipment_customs_data;
create policy shipment_customs_data_delete on public.shipment_customs_data for delete to authenticated
using (organization_id = user_org_id() and user_role() = any(array['owner'::user_role,'admin'::user_role,'broker'::user_role]));

grant select, insert, update, delete on public.shipment_customs_data to authenticated;