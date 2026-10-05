create or replace function public.crm_convert_quote_to_case_and_invoice(p_quote_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare q public.crm_quotes;c_id uuid;i_id uuid;invoice_no text;
begin
 select * into q from public.crm_quotes where id=p_quote_id and organization_id=public.user_org_id() for update;
 if not found then raise exception 'quote_not_found'; end if;
 if q.client_id is null then raise exception 'quote_client_required'; end if;
 select id into c_id from public.cases where organization_id=q.organization_id and client_id=q.client_id and display_name=q.title and status='draft'::case_status order by created_at desc limit 1;
 if c_id is null then insert into public.cases(organization_id,client_id,case_number,status,display_name,invoice_amount,invoice_currency) values(q.organization_id,q.client_id,'CRM-'||q.quote_no,'draft'::case_status,q.title,q.total,q.currency::currency_code) returning id into c_id; end if;
 invoice_no:='CRM-'||q.quote_no;
 if exists(select 1 from public.finance_invoices where organization_id=q.organization_id and invoice_no=invoice_no) then invoice_no:=invoice_no||'-'||to_char(now(),'YYYYMMDDHH24MISS'); end if;
 insert into public.finance_invoices(organization_id,client_id,invoice_no,invoice_year,status,issue_date,subtotal,discount_amount,vat_amount,total_amount,currency,payment_terms,public_note,created_by,updated_by)
 values(q.organization_id,q.client_id,invoice_no,extract(year from current_date)::int,'draft',current_date,q.subtotal,0,q.tax,q.total,q.currency::currency_code,q.notes,'تبدیل خودکار از پیشنهاد قیمت '||q.quote_no,auth.uid(),auth.uid()) returning id into i_id;
 update public.crm_quotes set status='accepted',updated_at=now() where id=q.id;
 return jsonb_build_object('quote_id',q.id,'case_id',c_id,'invoice_id',i_id);
end $$;
revoke all on function public.crm_convert_quote_to_case_and_invoice(uuid) from public,anon;
grant execute on function public.crm_convert_quote_to_case_and_invoice(uuid) to authenticated;
create or replace function public.crm_merge_contacts(p_master uuid,p_duplicate uuid,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare a public.crm_contacts;b public.crm_contacts;cid uuid;
begin
 select * into a from public.crm_contacts where id=p_master and organization_id=public.user_org_id() for update;
 select * into b from public.crm_contacts where id=p_duplicate and organization_id=public.user_org_id() for update;
 if a.id is null or b.id is null or a.id=b.id then raise exception 'contact_not_found_or_same'; end if;
 insert into public.crm_dedupe_clusters(organization_id,entity_type,master_id,candidate_ids,match_reason,status,snapshot,resolved_by,resolved_at)
 values(a.organization_id,'contact',a.id,array[b.id],jsonb_build_object('reason',p_reason),'merged',jsonb_build_object('duplicate',to_jsonb(b),'master_before',to_jsonb(a)),auth.uid(),now()) returning id into cid;
 update public.crm_activities set contact_id=a.id where contact_id=b.id and organization_id=a.organization_id;
 update public.crm_deals set contact_id=a.id where contact_id=b.id and organization_id=a.organization_id;
 update public.crm_contacts set deleted_at=now(),updated_at=now() where id=b.id;
 return jsonb_build_object('cluster_id',cid,'master_id',a.id,'duplicate_id',b.id);
end $$;
revoke all on function public.crm_merge_contacts(uuid,uuid,text) from public,anon;
grant execute on function public.crm_merge_contacts(uuid,uuid,text) to authenticated;
create or replace function public.crm_undo_merge(p_cluster_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare x public.crm_dedupe_clusters;dup uuid;
begin
 select * into x from public.crm_dedupe_clusters where id=p_cluster_id and organization_id=public.user_org_id() and status='merged' for update;
 if not found then raise exception 'merge_not_found'; end if;
 dup:=x.candidate_ids[1];update public.crm_contacts set deleted_at=null,updated_at=now() where id=dup and organization_id=x.organization_id;
 update public.crm_dedupe_clusters set status='undone',resolved_at=now(),resolved_by=auth.uid() where id=x.id;
 return jsonb_build_object('restored_contact_id',dup,'cluster_id',x.id);
end $$;
revoke all on function public.crm_undo_merge(uuid) from public,anon;
grant execute on function public.crm_undo_merge(uuid) to authenticated;
