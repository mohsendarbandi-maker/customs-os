begin;

do $$
declare
  v_issue_count integer;
  v_row record;
  v_failed boolean := false;
begin
  select count(*) into v_issue_count from public.finance_cost_invoice_integrity;
  if v_issue_count <> 3 then
    raise exception 'Expected three invoice/cost integrity exceptions, received %',v_issue_count;
  end if;

  select * into v_row
  from public.finance_cost_invoice_integrity
  where cost_item_id='20000000-0000-0000-0000-000000000001';
  if found then
    raise exception 'Cost linked to an active issued invoice must not be flagged';
  end if;

  select * into v_row
  from public.finance_cost_invoice_integrity
  where cost_item_id='20000000-0000-0000-0000-000000000002';
  if not found or v_row.integrity_issue <> 'MISSING_ACTIVE_INVOICE' then
    raise exception 'Orphaned invoiced cost was not detected';
  end if;

  select * into v_row
  from public.finance_cost_invoice_integrity
  where cost_item_id='20000000-0000-0000-0000-000000000003';
  if not found or v_row.integrity_issue <> 'INVOICE_LINK_STATUS_MISMATCH' then
    raise exception 'Confirmed cost linked to an invoice was not detected';
  end if;

  select * into v_row
  from public.finance_cost_invoice_integrity
  where cost_item_id='20000000-0000-0000-0000-000000000004';
  if not found or v_row.integrity_issue <> 'MISSING_ACTIVE_INVOICE'
     or v_row.archived_invoice_count <> 1 then
    raise exception 'Archived-only invoice link was not detected correctly';
  end if;
end;
$$;

-- Bypass RLS to prove the database guard also protects against service-role/direct SQL deletes.
set local role service_role;

do $$
declare
  v_failed boolean := false;
begin
  begin
    delete from public.finance_invoices
    where id='10000000-0000-0000-0000-000000000001';
  exception when check_violation then
    v_failed := position('حذف فیزیکی صورتحساب مجاز نیست' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'Issued invoice hard delete was not blocked by the database trigger';
  end if;

  begin
    delete from public.finance_invoices
    where id='10000000-0000-0000-0000-000000000002';
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Draft invoice hard delete was not blocked';
  end if;
end;
$$;

reset role;

do $$
begin
  if not exists(select 1 from public.finance_invoices where id='10000000-0000-0000-0000-000000000001') then
    raise exception 'Issued invoice row was physically deleted';
  end if;
  if not exists(select 1 from public.finance_invoice_lines where invoice_id='10000000-0000-0000-0000-000000000001') then
    raise exception 'Issued invoice source-cost line was cascade-deleted';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='finance_invoices'
      and policyname='finance_invoices_delete'
      and cmd='DELETE'
      and qual='false'
  ) then
    raise exception 'Authenticated direct invoice DELETE must remain denied by RLS';
  end if;
end;
$$;

rollback;
