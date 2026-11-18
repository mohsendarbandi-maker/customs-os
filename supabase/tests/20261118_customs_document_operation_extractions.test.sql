begin;

insert into public.organizations(id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into public.shipments(id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
insert into public.customs_declarations(id,organization_id,shipment_id)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.shipment_documents(
 id,organization_id,shipment_id,document_name,original_file_name,storage_path,mime_type,file_size_bytes,document_type
) values
 ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Invoice-1.pdf','source-invoice-1.pdf','org/one.pdf','application/pdf',100,'COMMERCIAL_INVOICE'),
 ('10000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Permit-2.pdf','source-permit-2.pdf','org/two.pdf','application/pdf',120,'IMPORT_LICENSE');

insert into public.file_manager_files(id,organization_id)
values ('20000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

update public.shipment_documents
set tags=array['invoice','commercial'],operation_sections=array['evaluation','cashier']
where id='10000000-0000-0000-0000-000000000001';
update public.shipment_documents
set tags=array['permit'],operation_sections=array['expertise']
where id='10000000-0000-0000-0000-000000000002';
update public.file_manager_files
set operation_sections=array['evaluation','cashier']
where id='20000000-0000-0000-0000-000000000001';

insert into public.customs_document_extractions(
 organization_id,declaration_id,shipment_id,shipment_document_id,source_key,operation_section,
 document_type,display_name,original_file_name,status,extracted_fields,provider,completed_at
) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '10000000-0000-0000-0000-000000000001','shipment-document:10000000-0000-0000-0000-000000000001','evaluation',
  'COMMERCIAL_INVOICE','Invoice 1','source-invoice-1.pdf','completed','{"assessed_value":"12345"}','test-provider',now()),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '10000000-0000-0000-0000-000000000001','shipment-document:10000000-0000-0000-0000-000000000001','cashier',
  'COMMERCIAL_INVOICE','Invoice 1','source-invoice-1.pdf','completed','{"receipt_number":"RC-1"}','test-provider',now()),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '10000000-0000-0000-0000-000000000002','shipment-document:10000000-0000-0000-0000-000000000002','cashier',
  'IMPORT_LICENSE','Permit 2','source-permit-2.pdf','completed','{"receipt_number":"RC-2"}','test-provider',now());

do $$
declare v_count integer; v_value text; v_rls boolean;
begin
 select count(*) into v_count from public.customs_document_extractions
  where declaration_id='cccccccc-cccc-cccc-cccc-cccccccccccc';
 if v_count<>3 then raise exception 'Expected three independent file/operation extraction rows, got %',v_count; end if;

 select extracted_fields->>'assessed_value' into v_value
  from public.customs_document_extractions
  where source_key='shipment-document:10000000-0000-0000-0000-000000000001'
    and operation_section='evaluation';
 if v_value<>'12345' then raise exception 'Evaluation extraction was not saved independently'; end if;

 select extracted_fields->>'receipt_number' into v_value
  from public.customs_document_extractions
  where source_key='shipment-document:10000000-0000-0000-0000-000000000002'
    and operation_section='cashier';
 if v_value<>'RC-2' then raise exception 'Second document cashier extraction was not saved'; end if;

 if (select tags from public.shipment_documents where id='10000000-0000-0000-0000-000000000001')<>array['invoice','commercial']::text[]
    or (select tags from public.shipment_documents where id='10000000-0000-0000-0000-000000000002')<>array['permit']::text[] then
   raise exception 'Document tags were not kept independently';
 end if;

 begin
  insert into public.customs_document_extractions(
   organization_id,declaration_id,shipment_document_id,source_key,operation_section,status
  ) values (
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc',
   '10000000-0000-0000-0000-000000000001',
   'shipment-document:10000000-0000-0000-0000-000000000001','evaluation','pending'
  );
  raise exception 'Duplicate document/operation extraction key was accepted';
 exception when unique_violation then null;
 end;

 select c.relrowsecurity into v_rls
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='customs_document_extractions';
 if not coalesce(v_rls,false) then raise exception 'RLS is not enabled for customs_document_extractions'; end if;
end;
$$;

rollback;
