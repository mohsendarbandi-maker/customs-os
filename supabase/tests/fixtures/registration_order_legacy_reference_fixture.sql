create type public.currency_code as enum ('IRR','USD','EUR','AED','CNY','RUB','GBP','CHF','TRY');
create table public.registration_orders (
 id uuid primary key,organization_id uuid not null,case_id uuid,order_number text not null,
 order_date date,status text not null default 'received',client_id uuid,tariff_code text,
 quantity numeric,quantity_unit text,net_weight_kg numeric,gross_weight_kg numeric,
 value_amount numeric,currency public.currency_code,is_closed boolean not null default false,closed_at timestamptz,
 unique(organization_id,order_number)
);
create table public.cases(id uuid primary key,organization_id uuid not null,registration_order_no text);
create table public.shipments(id uuid primary key,organization_id uuid not null,case_id uuid,registration_order_id uuid,client_id uuid,net_weight_kg numeric,gross_weight_kg numeric);
create table public.shipment_customs_data(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,shipment_id uuid not null,
 registration_order_no text,net_weight_kg numeric,gross_weight_kg numeric,invoice_amount numeric,invoice_currency text
);
create table public.registration_order_external_allocations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,registration_order_id uuid not null,
 status text not null default 'allocated',net_weight_kg numeric,gross_weight_kg numeric,value_amount numeric,currency public.currency_code
);
