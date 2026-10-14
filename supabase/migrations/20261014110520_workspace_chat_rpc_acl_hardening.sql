-- Restrict direct RPC execution of chat trigger/playback helpers.
-- Applied to production migration history as 20261014110520.
-- chat_mark_played remains callable by authenticated users; the function itself
-- validates voice-message existence and current conversation membership.
-- prepare_chat_attachment_security is retained for its existing BEFORE trigger,
-- but is not exposed as a direct Data API RPC.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.chat_mark_played(uuid) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.prepare_chat_attachment_security() FROM PUBLIC, anon, authenticated;

COMMIT;
