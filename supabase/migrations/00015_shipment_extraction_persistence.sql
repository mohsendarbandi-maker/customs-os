create table if not exists public.shipment_document_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  document_id uuid references public.shipment_documents(id) on delete cascade,
  field_key text not null,
  field_label text,
  extracted_value text,
  source_text text,
  confidence numeric(5,4),
  page_number integer,
  extraction_method text not null default 'ai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.shipment_document_extractions enable row level security;
create index if not exists idx_shipment_doc_extractions_shipment on public.shipment_document_extractions(shipment_id);
create index if not exists idx_shipment_doc_extractions_document on public.shipment_document_extractions(document_id);
create unique index if not exists uq_shipment_doc_extraction_field on public.shipment_document_extractions(shipment_id, document_id, field_key);
drop policy if exists shipment_doc_extractions_select on public.shipment_document_extractions;
drop policy if exists shipment_doc_extractions_insert on public.shipment_document_extractions;
drop policy if exists shipment_doc_extractions_update on public.shipment_document_extractions;
drop policy if exists shipment_doc_extractions_delete on public.shipment_document_extractions;
create policy shipment_doc_extractions_select on public.shipment_document_extractions for select to authenticated using (organization_id = public.user_org_id());
create policy shipment_doc_extractions_insert on public.shipment_document_extractions for insert to authenticated with check (organization_id = public.user_org_id());
create policy shipment_doc_extractions_update on public.shipment_document_extractions for update to authenticated using (organization_id = public.user_org_id()) with check (organization_id = public.user_org_id());
create policy shipment_doc_extractions_delete on public.shipment_document_extractions for delete to authenticated using (organization_id = public.user_org_id());
grant select,insert,update,delete on public.shipment_document_extractions to authenticated;
