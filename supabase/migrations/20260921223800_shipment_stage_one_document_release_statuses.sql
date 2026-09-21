alter table public.shipments
  add column if not exists transport_documents_status text not null default 'not_ready'
    check (transport_documents_status in ('not_ready','ready')),
  add column if not exists release_invoice_payment_status text not null default 'unpaid'
    check (release_invoice_payment_status in ('unpaid','paid'));

comment on column public.shipments.transport_documents_status is 'Stage 1 status for transport documents and warehouse receipt: not_ready or ready.';
comment on column public.shipments.release_invoice_payment_status is 'Stage 1 customs release invoice payment status: unpaid or paid.';
