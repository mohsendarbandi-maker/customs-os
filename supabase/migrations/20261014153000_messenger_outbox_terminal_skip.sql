-- Terminally skip messenger deliveries that can never be sent.
-- Examples include messages deleted after enqueue or destinations unlinked before send.
alter table public.messenger_delivery_outbox
  drop constraint if exists messenger_delivery_outbox_status_check;

alter table public.messenger_delivery_outbox
  add constraint messenger_delivery_outbox_status_check
  check (status = any (array[
    'queued'::text,
    'sending'::text,
    'sent'::text,
    'delivered'::text,
    'read'::text,
    'failed'::text,
    'skipped'::text
  ]));

create or replace function public.messenger_claim_delivery_outbox(p_limit integer default 50)
returns setof public.messenger_delivery_outbox
language sql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
  with picked as (
    select o.id
    from public.messenger_delivery_outbox o
    where o.attempt_count < 12
      and (
        (
          o.status in ('queued','failed')
          and o.next_attempt_at <= now()
          and coalesce(o.last_error_code, '') not in (
            'MESSAGE_NOT_ELIGIBLE_FOR_EXTERNAL_DELIVERY',
            'DESTINATION_NO_LONGER_LINKED'
          )
        )
        or (o.status='sending' and o.updated_at < now() - interval '5 minutes')
      )
    order by o.created_at, o.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,50),100))
  )
  update public.messenger_delivery_outbox o
  set status='sending',
      attempt_count=o.attempt_count+1,
      last_error_code=case when o.status='sending' then 'STALE_DELIVERY_RECOVERED' else null end,
      updated_at=now()
  from picked
  where o.id=picked.id
  returning o.*;
$function$;

-- Close old retry loops created before terminal delivery handling was introduced.
update public.messenger_delivery_outbox
set status='skipped',
    updated_at=now()
where status='failed'
  and last_error_code in (
    'MESSAGE_NOT_ELIGIBLE_FOR_EXTERNAL_DELIVERY',
    'DESTINATION_NO_LONGER_LINKED'
  );
