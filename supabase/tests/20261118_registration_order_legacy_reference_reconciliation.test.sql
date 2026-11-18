begin;
insert into public.registration_orders(id,organization_id,order_number,client_id,net_weight_kg,value_amount,currency)
values
 ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','91484919','20000000-0000-0000-0000-000000000001',1000,1000,'USD'),
 ('10000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','92733074','20000000-0000-0000-0000-000000000001',1000,1000,'USD'),
 ('10000000-0000-0000-0000-000000000003','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','91484919','20000000-0000-0000-0000-000000000002',1000,1000,'USD'),
 ('10000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','۹۱۴۸۴۹۱۹','20000000-0000-0000-0000-000000000001',500,500,'USD');
insert into public.cases(id,organization_id,registration_order_no)
values('30000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','92733074');
insert into public.shipments(id,organization_id,client_id,case_id,registration_order_id,display_name,bill_of_lading_no,net_weight_kg,gross_weight_kg)
values
 ('40000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001',null,null,'۱۷ رول ارس تارلا امین','BL-17',200,201),
 ('40000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001',null,null,'۳۷ رول ارس تارلا امین','BL-37',300,301),
 ('40000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',null,'conflicting case and customs','BL-X',10,11),
 ('40000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000002','explicit master FK','BL-DIRECT',20,21),
 ('40000000-0000-0000-0000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001',null,null,'ambiguous normalized master number','BL-AMB',30,31),
 ('40000000-0000-0000-0000-000000000006','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001',null,null,'foreign tenant match','BL-FOREIGN',40,41),
 ('40000000-0000-0000-0000-000000000007','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',null,'already case-linked','BL-CASE',50,51);
insert into public.shipment_customs_data(shipment_id,organization_id,registration_order_no,net_weight_kg,gross_weight_kg,invoice_amount,invoice_currency)
values
 ('40000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','۹۱۴۸۴۹۱۹',200,201,120000,'دلار آمریکا (USD)'),
 ('40000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','91484919',300,301,180000,'USD'),
 ('40000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','91484919',10,11,5000,'USD'),
 ('40000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','91484919',20,21,10000,'USD'),
 ('40000000-0000-0000-0000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','91484919',30,31,15000,'USD'),
 ('40000000-0000-0000-0000-000000000006','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','91484919',40,41,20000,'USD'),
 ('40000000-0000-0000-0000-000000000007','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','92733074',50,51,25000,'USD');

do $$
declare v_id uuid; v_count integer;
begin
 if public.normalize_registration_order_reference(' ۹۱۴۸۴۹۱۹ ')<>'91484919' then
   raise exception 'Persian digit normalization failed';
 end if;
 if public.registration_order_legacy_candidate_id('40000000-0000-0000-0000-000000000001','۹۱۴۸۴۹۱۹') is not null then
   raise exception 'Normalized duplicate master numbers must be treated as ambiguous';
 end if;
 delete from public.registration_orders where id='10000000-0000-0000-0000-000000000004';
 if public.registration_order_legacy_candidate_id('40000000-0000-0000-0000-000000000001','۹۱۴۸۴۹۱۹')<>'10000000-0000-0000-0000-000000000001' then
   raise exception 'Unique same-tenant and same-owner legacy reference did not match';
 end if;
 if public.registration_order_legacy_candidate_id('40000000-0000-0000-0000-000000000006','91484919') is not null then
   raise exception 'Candidate must not cross tenant/owner boundaries';
 end if;
 if public.registration_order_legacy_candidate_id('40000000-0000-0000-0000-000000000004','91484919') is not null then
   raise exception 'Explicit master-linked shipment must not be an unresolved candidate';
 end if;
 select count(*) into v_count from public.registration_order_legacy_match_candidates
 where registration_order_id='10000000-0000-0000-0000-000000000002';
 if v_count<>2 then raise exception 'Expected only two unambiguous unresolved customs-reference candidates, got %',v_count; end if;
 if exists(select 1 from public.registration_order_legacy_match_candidates where shipment_id in (
   '40000000-0000-0000-0000-000000000003',
   '40000000-0000-0000-0000-000000000004',
   '40000000-0000-0000-0000-000000000005',
   '40000000-0000-0000-0000-000000000006',
   '40000000-0000-0000-0000-000000000007'
 )) then
   raise exception 'Conflicting, ambiguous, cross-tenant, or already-linked rows leaked into candidate view';
 end if;
end;
$$;
rollback;
