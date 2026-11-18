-- Issued financial documents must never be physically deleted.
-- Draft deletion is already handled by archive_finance_invoice(); keep all invoice
-- history and source-cost links intact even for service-role/direct SQL callers.

create or replace function public.prevent_finance_invoice_hard_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'حذف فیزیکی صورتحساب مجاز نیست؛ برای پیش‌نویس از مسیر بایگانی قابل‌بازیابی استفاده کنید و صورتحساب صادرشده باید با سند اصلاحی/ابطال تعیین تکلیف شود.';
end;
$$;

drop trigger if exists trg_prevent_finance_invoice_hard_delete
  on public.finance_invoices;
create trigger trg_prevent_finance_invoice_hard_delete
before delete on public.finance_invoices
for each row execute function public.prevent_finance_invoice_hard_delete();

comment on function public.prevent_finance_invoice_hard_delete() is
  'Blocks physical invoice deletion, including service-role deletes, to preserve issued financial history and source-cost line links.';

-- Read-only integrity signal for approved costs whose invoice state no longer
-- matches their surviving invoice-line relationships.
create or replace view public.finance_cost_invoice_integrity
with (security_invoker = true)
as
select
  c.id as cost_item_id,
  c.organization_id,
  c.shipment_id,
  c.case_id,
  c.client_id,
  c.description,
  c.status as cost_status,
  c.approval_status,
  c.billable,
  c.amount_irr,
  c.vat_amount,
  coalesce(x.invoice_line_count, 0)::integer as invoice_line_count,
  coalesce(x.active_invoice_count, 0)::integer as active_invoice_count,
  coalesce(x.archived_invoice_count, 0)::integer as archived_invoice_count,
  x.active_invoice_numbers,
  case
    when c.status in ('invoiced', 'paid')
      and coalesce(x.active_invoice_count, 0) = 0
      then 'MISSING_ACTIVE_INVOICE'
    when coalesce(x.active_invoice_count, 0) > 1
      then 'MULTIPLE_ACTIVE_INVOICES'
    when c.status = 'confirmed'
      and coalesce(x.active_invoice_count, 0) > 0
      then 'INVOICE_LINK_STATUS_MISMATCH'
    else null
  end as integrity_issue
from public.finance_cost_items c
left join lateral (
  select
    count(l.id)::integer as invoice_line_count,
    count(distinct i.id) filter (
      where i.id is not null
        and i.deleted_at is null
        and i.status not in ('void', 'cancelled')
    )::integer as active_invoice_count,
    count(distinct i.id) filter (
      where i.id is not null and i.deleted_at is not null
    )::integer as archived_invoice_count,
    string_agg(distinct i.invoice_no, ', ' order by i.invoice_no) filter (
      where i.id is not null
        and i.deleted_at is null
        and i.status not in ('void', 'cancelled')
    ) as active_invoice_numbers
  from public.finance_invoice_lines l
  left join public.finance_invoices i
    on i.id = l.invoice_id
   and i.organization_id = l.organization_id
  where l.cost_item_id = c.id
    and l.organization_id = c.organization_id
) x on true
where c.deleted_at is null
  and c.approval_status = 'approved'
  and c.billable = true
  and (
    (c.status in ('invoiced', 'paid') and coalesce(x.active_invoice_count, 0) = 0)
    or coalesce(x.active_invoice_count, 0) > 1
    or (c.status = 'confirmed' and coalesce(x.active_invoice_count, 0) > 0)
  );

grant select on public.finance_cost_invoice_integrity to authenticated;

comment on view public.finance_cost_invoice_integrity is
  'Read-only exception report for approved billable costs whose status and surviving active invoice links are inconsistent.';
