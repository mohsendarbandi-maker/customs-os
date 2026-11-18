begin;
insert into public.shipment_documents(
 id,organization_id,shipment_id,document_name,original_file_name,storage_path,mime_type,file_size_bytes,
 document_type,document_number,issue_date,issue_date_shamsi,invoice_amount,invoice_currency
) values
 ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Proforma PI-001.pdf','Proforma PI-001.pdf','org/shipment/proforma.pdf','application/pdf',100,
  'PROFORMA_INVOICE','PI-001',null,'1405/08/21',12500,'USD'),
 ('10000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Commercial CI-002.pdf','Commercial CI-002.pdf','org/shipment/commercial.pdf','application/pdf',120,
  'COMMERCIAL_INVOICE','CI-002','2026-11-18','1405/08/27',12300,'USD');

do $$
declare v_proforma public.shipment_documents%rowtype; v_invoice public.shipment_documents%rowtype;
begin
 select * into v_proforma from public.shipment_documents where id='10000000-0000-0000-0000-000000000001';
 select * into v_invoice from public.shipment_documents where id='10000000-0000-0000-0000-000000000002';
 if v_proforma.document_type<>'PROFORMA_INVOICE' or v_proforma.document_number<>'PI-001'
    or v_proforma.issue_date is not null or v_proforma.issue_date_shamsi<>'1405/08/21' then
   raise exception 'Proforma metadata was not preserved independently';
 end if;
 if v_invoice.document_type<>'COMMERCIAL_INVOICE' or v_invoice.document_number<>'CI-002'
    or v_invoice.issue_date<>date '2026-11-18' or v_invoice.issue_date_shamsi<>'1405/08/27' then
   raise exception 'Commercial invoice metadata was not preserved independently';
 end if;
 update public.shipment_documents set document_number='CI-UPDATED'
 where id='10000000-0000-0000-0000-000000000002';
 if (select document_number from public.shipment_documents where id='10000000-0000-0000-0000-000000000001')<>'PI-001' then
   raise exception 'Editing commercial invoice overwrote proforma number';
 end if;
end;
$$;
rollback;
