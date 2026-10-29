-- Avoid running a full organization-wide shipment hierarchy write pass on every chat list read.
-- Only repair when an expected owner/shipment group or the current user's membership is missing.
CREATE OR REPLACE FUNCTION public.chat_hierarchy_list(p_limit integer DEFAULT 200)
RETURNS TABLE(
  conversation_id uuid,
  type text,
  title text,
  updated_at timestamp with time zone,
  last_message_id uuid,
  last_message_body text,
  last_message_created_at timestamp with time zone,
  unread_count bigint,
  muted_until timestamp with time zone,
  hierarchy_kind text,
  parent_conversation_id uuid,
  cargo_owner_id uuid,
  shipment_id uuid,
  shipment_display_name text,
  shipment_bl_number text,
  shipment_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid := public.user_org_id();
  v_role text := public.user_role()::text;
  v_client_id uuid;
  v_needs_sync boolean := false;
BEGIN
  IF v_user IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'احراز هویت الزامی است';
  END IF;

  IF v_role = 'client' THEN
    SELECT p.client_id INTO v_client_id
    FROM public.profiles p
    WHERE p.id = v_user
      AND p.organization_id = v_org
      AND p.is_active = true;
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.clients cl
      WHERE cl.organization_id = v_org
        AND (v_role <> 'client' OR cl.id = v_client_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.chat_conversations owner_room
          WHERE owner_room.organization_id = v_org
            AND owner_room.cargo_owner_id = cl.id
            AND owner_room.hierarchy_kind = 'owner_group'
            AND owner_room.deleted_at IS NULL
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.shipments s
      JOIN public.clients cl ON cl.id = s.client_id AND cl.organization_id = v_org
      WHERE s.organization_id = v_org
        AND (v_role <> 'client' OR cl.id = v_client_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.chat_conversations shipment_room
          WHERE shipment_room.organization_id = v_org
            AND shipment_room.shipment_id = s.id
            AND shipment_room.hierarchy_kind = 'shipment_group'
            AND shipment_room.deleted_at IS NULL
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_conversations owner_room
      JOIN public.clients cl ON cl.id = owner_room.cargo_owner_id AND cl.organization_id = v_org
      WHERE owner_room.organization_id = v_org
        AND owner_room.hierarchy_kind = 'owner_group'
        AND owner_room.deleted_at IS NULL
        AND (v_role <> 'client' OR cl.id = v_client_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.chat_conversation_members m
          WHERE m.conversation_id = owner_room.id AND m.user_id = v_user
            AND m.deleted_at IS NULL AND m.left_at IS NULL
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_conversations shipment_room
      JOIN public.chat_conversations owner_room
        ON owner_room.id = shipment_room.parent_conversation_id
       AND owner_room.organization_id = v_org
       AND owner_room.hierarchy_kind = 'owner_group'
       AND owner_room.deleted_at IS NULL
      JOIN public.clients cl ON cl.id = owner_room.cargo_owner_id AND cl.organization_id = v_org
      WHERE shipment_room.organization_id = v_org
        AND shipment_room.hierarchy_kind = 'shipment_group'
        AND shipment_room.deleted_at IS NULL
        AND (v_role <> 'client' OR cl.id = v_client_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.chat_conversation_members m
          WHERE m.conversation_id = shipment_room.id AND m.user_id = v_user
            AND m.deleted_at IS NULL AND m.left_at IS NULL
        )
    )
  INTO v_needs_sync;

  IF v_needs_sync THEN
    PERFORM public.chat_sync_shipment_hierarchy();
  END IF;

  RETURN QUERY
  SELECT c.id, c.type, c.title, c.updated_at, lm.id,
    CASE WHEN lm.deleted_at IS NULL THEN lm.body ELSE NULL END,
    lm.created_at, public.chat_unread_count(c.id), me.muted_until,
    c.hierarchy_kind, c.parent_conversation_id, c.cargo_owner_id, c.shipment_id,
    s.display_name::text, s.bill_of_lading_no::text, s.current_status::text
  FROM public.chat_conversations c
  JOIN public.chat_conversation_members me
    ON me.conversation_id = c.id AND me.user_id = v_user
   AND me.deleted_at IS NULL AND me.left_at IS NULL
  LEFT JOIN public.shipments s ON s.id = c.shipment_id AND s.organization_id = c.organization_id
  LEFT JOIN LATERAL (
    SELECT m.* FROM public.chat_messages m
    WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_message_user_states us
        WHERE us.message_id = m.id AND us.user_id = v_user AND us.deleted_at IS NOT NULL
      )
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) lm ON true
  WHERE c.deleted_at IS NULL AND c.organization_id = v_org
    AND c.hierarchy_kind IN ('owner_group', 'shipment_group')
  ORDER BY CASE WHEN c.hierarchy_kind = 'owner_group' THEN 0 ELSE 1 END,
    c.title NULLS LAST, c.updated_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 200), 200));
END;
$function$;
