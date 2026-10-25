BEGIN;

ALTER TABLE public.messenger_chats
  DROP CONSTRAINT IF EXISTS messenger_chat_conversation_required_for_routed_purposes;

ALTER TABLE public.messenger_chats
  ADD CONSTRAINT messenger_chat_conversation_required_for_routed_purposes
  CHECK (
    enabled IS NOT TRUE
    OR purpose NOT IN ('inbox', 'shipment_notifications', 'shipment')
    OR conversation_id IS NOT NULL
  );

COMMIT;
