-- chat_enqueue_message_notifications uses ON CONFLICT(user_id, message_id).
-- Keep one notification per user/message so message inserts cannot fail in the trigger.
alter table public.notification_outbox
  add constraint notification_outbox_user_message_unique unique (user_id, message_id);
