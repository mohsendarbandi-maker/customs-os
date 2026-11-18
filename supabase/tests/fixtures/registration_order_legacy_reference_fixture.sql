DO $$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

create type public.currency_code as enum ('IRR','USD','EUR','AED','CNY','RUB','GBP','CHF','TRY');
create table public.registration_orders (
 id uuid primary key,organization_id uuid not null,case_id uuid,order_number text not null,
 client_id uuid,net_weight_kg numeric,gross_weight_kg numeric,value_amount numeric,
 currency public.currency_code,is_closed boolean not null default false,
 unique(organization_id,order_number)
);
create table public.cases(id uuid primary key,organization_id uuid not null,registration_order_no text);
create table public.shipments(
 id uuid primary key,organization_id uuid not null,case_id uuid,registration_order_id uuid,
 client_id uuid,display_name text,bill_of_lading_no text,net_weight_kg numeric,gross_weight_kg numeric
);
create table public.shipment_customs_data(
 shipment_id uuid primary key,organization_id uuid not null,registration_order_no text,
 net_weight_kg numeric,gross_weight_kg numeric,invoice_amount numeric,invoice_currency text
);
