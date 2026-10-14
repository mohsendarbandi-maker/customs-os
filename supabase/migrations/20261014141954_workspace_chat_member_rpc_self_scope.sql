CREATE OR REPLACE FUNCTION public.chat_user_is_member(
  p_conversation_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND p_user_id = auth.uid()
     AND EXISTS (
       SELECT 1
       FROM public.chat_conversation_members m
       WHERE m.conversation_id = p_conversation_id
         AND m.user_id = auth.uid()
         AND m.deleted_at IS NULL
         AND m.left_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM public.profiles p
           WHERE p.id = m.user_id
             AND p.is_active = true
         )
     );
$function$;
