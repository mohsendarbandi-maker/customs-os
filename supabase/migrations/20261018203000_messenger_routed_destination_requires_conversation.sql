-- Routed chat destinations must point at a canonical internal conversation.
-- Daily reports are intentionally excluded: their trigger creates a canonical report channel.
-- File archives are intentionally excluded: they are not conversation destinations.
alter table public.messenger_chats
  add constraint messenger_chat_conversation_required_for_routed_purposes
  check (
    purpose not in ('inbox','shipment_notifications','shipment')
    or conversation_id is not null
  );
