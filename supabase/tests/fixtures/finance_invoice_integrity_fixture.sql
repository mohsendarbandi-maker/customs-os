DO $$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

create table public.finance_invoices (
  id uuid primary key,
  organization_id uuid not null,
  invoice_no text not null,
  status text not null check(status in ('draft','issued','partially_paid','paid','void')),
  issued_at timestamptz,
  deleted_at timestamptz
);

create table public.finance_cost_items (
  id uuid primary key,
  organization_id uuid not null,
  shipment_id uuid,
  case_id uuid,
  client_id uuid,
  description text not null,
  status text not null check(status in ('draft','confirmed','invoiced','paid','cancelled')),
  approval_status text not null,
  billable boolean not null default true,
  amount_irr numeric not null,
  vat_amount numeric not null default 0,
  deleted_at timestamptz
);

create table public.finance_invoice_lines (
  id uuid primary key,
  organization_id uuid not null,
  invoice_id uuid not null references public.finance_invoices(id) on delete cascade,
  cost_item_id uuid references public.finance_cost_items(id) on delete restrict,
  shipment_id uuid,
  description text not null,
  amount numeric not null
);

alter table public.finance_invoices enable row level security;
create policy finance_invoices_delete
  on public.finance_invoices for delete to authenticated using (false);

grant select, insert, update, delete on public.finance_invoices to authenticated, service_role;
grant select, insert, update, delete on public.finance_cost_items to authenticated, service_role;
grant select, insert, update, delete on public.finance_invoice_lines to authenticated, service_role;

insert into public.finance_invoices(id,organization_id,invoice_no,status,issued_at,deleted_at) values
 ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','FIN-2026-00001','issued','2026-10-01T10:00:00Z',null),
 ('10000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','FIN-2026-00002','draft',null,null),
 ('10000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','FIN-2026-00003','void','2026-10-02T10:00:00Z',null),
 ('10000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','FIN-2026-00004','draft',null,'2026-10-03T10:00:00Z');

insert into public.finance_cost_items(
 id,organization_id,description,status,approval_status,billable,amount_irr,vat_amount
) values
 ('20000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','linked issued cost','invoiced','approved',true,45000000,0),
 ('20000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','orphaned invoice state','invoiced','approved',true,1000000,0),
 ('20000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','incorrect confirmed state','confirmed','approved',true,2000000,0),
 ('20000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','paid without active invoice','paid','approved',true,3000000,0);

insert into public.finance_invoice_lines(
 id,organization_id,invoice_id,cost_item_id,description,amount
) values
 ('30000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','linked issued cost',45000000),
 ('30000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','draft invoice line',2000000),
 ('30000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004','archived invoice line',3000000);
