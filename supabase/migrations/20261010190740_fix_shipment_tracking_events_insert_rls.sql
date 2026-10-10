-- Restore tenant-scoped INSERT permission for shipment tracking events.
-- The status RPC validates the authenticated user, role, organization, and shipment;
-- this policy enforces the same boundaries at the table's RLS layer.

DROP POLICY IF EXISTS shipment_tracking_events_insert_org
ON public.shipment_tracking_events;

CREATE POLICY shipment_tracking_events_insert_org
ON public.shipment_tracking_events
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = (SELECT public.user_org_id())
  AND (SELECT public.user_role()) IN ('owner', 'admin', 'broker')
  AND EXISTS (
    SELECT 1
    FROM public.shipments AS s
    WHERE s.id = shipment_tracking_events.shipment_id
      AND s.organization_id = shipment_tracking_events.organization_id
  )
);
