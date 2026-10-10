BEGIN;

DROP POLICY IF EXISTS chat_realtime_select ON realtime.messages;
CREATE POLICY chat_realtime_select
ON realtime.messages
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  realtime.topic() ~ '^chat:[0-9a-fA-F-]{36}$'
  AND EXISTS (
    SELECT 1
    FROM public.chat_conversation_members m
    WHERE m.conversation_id::text = lower(substring(realtime.topic() FROM 6))
      AND m.user_id = (SELECT auth.uid())
      AND m.deleted_at IS NULL
      AND m.left_at IS NULL
  )
  AND extension IN ('broadcast', 'presence')
);

DROP POLICY IF EXISTS chat_realtime_insert ON realtime.messages;
CREATE POLICY chat_realtime_insert
ON realtime.messages
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() ~ '^chat:[0-9a-fA-F-]{36}$'
  AND EXISTS (
    SELECT 1
    FROM public.chat_conversation_members m
    WHERE m.conversation_id::text = lower(substring(realtime.topic() FROM 6))
      AND m.user_id = (SELECT auth.uid())
      AND m.deleted_at IS NULL
      AND m.left_at IS NULL
  )
  AND extension IN ('broadcast', 'presence')
);

DROP POLICY IF EXISTS chat_voice_call_select ON realtime.messages;
CREATE POLICY chat_voice_call_select
ON realtime.messages
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  realtime.topic() ~ '^voice:[0-9a-fA-F-]{36}$'
  AND extension = 'broadcast'
  AND EXISTS (
    SELECT 1
    FROM public.chat_voice_calls c
    WHERE c.id::text = lower(substring(realtime.topic() FROM 7))
      AND (
        c.caller_id = (SELECT auth.uid())
        OR c.callee_id = (SELECT auth.uid())
      )
      AND c.status IN ('ringing', 'accepted', 'active')
  )
);

DROP POLICY IF EXISTS chat_voice_call_insert ON realtime.messages;
CREATE POLICY chat_voice_call_insert
ON realtime.messages
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() ~ '^voice:[0-9a-fA-F-]{36}$'
  AND extension = 'broadcast'
  AND EXISTS (
    SELECT 1
    FROM public.chat_voice_calls c
    WHERE c.id::text = lower(substring(realtime.topic() FROM 7))
      AND (
        c.caller_id = (SELECT auth.uid())
        OR c.callee_id = (SELECT auth.uid())
      )
      AND c.status IN ('ringing', 'accepted', 'active')
  )
);

COMMIT;
