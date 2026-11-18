-- Canonical shipment documents need document-level metadata independent of the shipment.
-- document_type distinguishes proforma vs commercial invoice; the shared number/date
-- columns are reused per document row, so the two invoices never overwrite one another.
-- Gregorian date is stored as DATE; the original/display Jalali string remains separate.
alter table public.shipment_documents
  add column if not exists document_type text,
  add column if not exists document_number text,
  add column if not exists issue_date date,
  add column if not exists issue_date_shamsi text,
  add column if not exists invoice_amount numeric,
  add column if not exists invoice_currency text;

comment on column public.shipment_documents.document_type is
  'Document kind for this canonical shipment file; PROFORMA_INVOICE and COMMERCIAL_INVOICE are independent document rows.';
comment on column public.shipment_documents.document_number is
  'Number printed on this individual document, independent from all other document types in the shipment.';
comment on column public.shipment_documents.issue_date is
  'Gregorian issue date for this individual document; stored as a SQL DATE.';
comment on column public.shipment_documents.issue_date_shamsi is
  'Original/display Jalali issue-date text; no implicit calendar conversion is assumed.';
comment on column public.shipment_documents.invoice_amount is
  'Amount printed on this individual proforma/commercial invoice document, not the shipment-level aggregate.';
comment on column public.shipment_documents.invoice_currency is
  'Currency printed on this individual proforma/commercial invoice document.';
