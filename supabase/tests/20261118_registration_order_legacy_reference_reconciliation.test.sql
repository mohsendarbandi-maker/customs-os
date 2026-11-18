begin;
insert into public.registration_orders(id,organization_id,order_number,client_id,net_weight_kg,gross_weight_kg,value_amount,currency)
values
 ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','91484919','20000000-0000-0000-0000-000000000001',600,600,800,'USD'),
 ('10000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','92733074','20000000-0000-0000-0000-000000000001',1000,1000,1000,'AED'),
 ('10000000-0000-0000-0000-000000000003','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','91484919','20000000-0000-0000-0000-000000000002',50,50,50,'USD');
insert into public.cases(id,organization_id,registration_order_no)
values('30000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','92733074');
insert into public.shipments(id,organization_id,client_id,net_weight_kg,gross_weight_kg)
values
 ('40000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001',200,200),
 ('40000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001',300,300),
 ('40000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001',10,10),
 ('40000000-0000-0000-0000-000000000004','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','20000000-0000-0000-0000-000000000001',20,20);
update public.shipments set case_id='30000000-0000-0000-0000-000000000002' where id='40000000-0000-0000-0000-000000000003';
update public.shipments set registration_order_id='10000000-0000-0000-0000-000000000002' where id='40000000-0000-0000-0000-000000000004';
insert into public.shipment_customs_data(organization_id,shipment_id,registration_order_no,net_weight_kg,gross_weight_kg,invoice_amount,invoice_currency)
values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','40000000-0000-0000-0000-000000000001','۹۱۴۸۴۹۱۹',200,200,300,'دلار آمریکا (USD)'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','40000000-0000-0000-0000-000000000002','91484919',300,300,400,'USD'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','40000000-0000-0000-0000-000000000003','91484919',10,10,10,'USD'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','40000000-0000-0000-0000-000000000004','91484919',20,20,20,'AED');
insert into public.registration_order_external_allocations(organization_id,registration_order_id,status,net_weight_kg,gross_weight_kg,value_amount,currency)
values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','10000000-0000-0000-0000-000000000001','allocated',100,100,100,'USD');

do $$
declare v_id uuid; v_row record; v_failed boolean:=false;
begin
 if public.registration_order_id_for_shipment('40000000-0000-0000-0000-000000000001') <> '10000000-0000-0000-0000-000000000001' then
   raise exception 'Persian numeral legacy reference did not match master registration order';
 end if;
 if public.registration_order_id_for_shipment('40000000-0000-0000-0000-000000000003') is not null then
   raise exception 'Conflicting legacy references must remain unassigned';
 end if;
 if public.registration_order_id_for_shipment('40000000-0000-0000-0000-000000000004') <> '10000000-0000-0000-0000-000000000002' then
   raise exception 'Explicit master FK must override stale legacy text';
 end if;
 select * into v_row from public.registration_order_reconciliation
 where registration_order_id='10000000-0000-0000-0000-000000000001';
 if v_row.shipment_count<>2 or v_row.shipped_net_weight_kg<>500 or v_row.shipped_gross_weight_kg<>500
    or v_row.shipped_value_amount<>700 or v_row.shipments_missing_invoice_value<>0
    or v_row.shipments_with_currency_mismatch<>0 or v_row.total_allocated_net_weight_kg<>600
    or v_row.total_allocated_value_amount<>800 then
   raise exception 'Legacy reconciliation totals are wrong: %',row_to_json(v_row);
 end if;
 perform public.assert_registration_order_totals('10000000-0000-0000-0000-000000000001');
 update public.registration_orders set is_closed=true,closed_at=clock_timestamp()
 where id='10000000-0000-0000-0000-000000000001';
 begin
   update public.shipment_customs_data set registration_order_no='UNKNOWN'
   where shipment_id='40000000-0000-0000-0000-000000000001';
 exception when check_violation then v_failed:=true;
 end;
 if not v_failed then raise exception 'Changing closed-order legacy reference must fail and rollback'; end if;
 if (select registration_order_no from public.shipment_customs_data where shipment_id='40000000-0000-0000-0000-000000000001')<>'۹۱۴۸۴۹۱۹' then
   raise exception 'Rejected legacy reference change was not rolled back';
 end if;
end;
$$;
rollback;
