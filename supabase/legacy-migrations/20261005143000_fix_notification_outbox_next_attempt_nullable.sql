-- notification_outbox is a retry/outbox table; successful delivery intentionally clears next_attempt_at.
alter table public.notification_outbox
  alter column next_attempt_at drop not null;
