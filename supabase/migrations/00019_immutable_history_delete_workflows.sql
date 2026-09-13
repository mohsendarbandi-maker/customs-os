-- 00019: Delete operational records without modifying immutable history.

ALTER TABLE public.case_status_history ALTER COLUMN case_id SET NOT NULL;
ALTER TABLE public.case_status_history DROP CONSTRAINT IF EXISTS fk_status_history_case_tenant;
ALTER TABLE public.shipment_tracking_events DROP CONSTRAINT IF EXISTS shipment_tracking_events_shipment_id_fkey;

CREATE OR REPLACE FUNCTION public.delete_shipment_workflow(p_shipment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org:=public.user_org_id();
  IF v_org IS NULL OR public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'Insufficient access'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shipments WHERE id=p_shipment_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Shipment not found or access denied'; END IF;
  DELETE FROM public.shipments WHERE id=p_shipment_id AND organization_id=v_org;
END; $$;
REVOKE EXECUTE ON FUNCTION public.delete_shipment_workflow(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_shipment_workflow(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_case_workflow(p_case_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org:=public.user_org_id();
  IF v_org IS NULL OR public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'Insufficient access'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cases WHERE id=p_case_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Case not found or access denied'; END IF;
  DELETE FROM public.registration_orders WHERE case_id=p_case_id AND organization_id=v_org;
  DELETE FROM public.documents WHERE case_id=p_case_id AND organization_id=v_org;
  DELETE FROM public.financial_transactions WHERE case_id=p_case_id AND organization_id=v_org;
  DELETE FROM public.permits WHERE case_id=p_case_id AND organization_id=v_org;
  DELETE FROM public.customs_declarations WHERE case_id=p_case_id AND organization_id=v_org;
  DELETE FROM public.shipments WHERE case_id=p_case_id AND organization_id=v_org;
  DELETE FROM public.cases WHERE id=p_case_id AND organization_id=v_org;
END; $$;
REVOKE EXECUTE ON FUNCTION public.delete_case_workflow(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_case_workflow(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_client_workflow(p_client_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_secret_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org:=public.user_org_id();
  IF v_org IS NULL OR public.user_role() NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Insufficient access'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id=p_client_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Client not found or access denied'; END IF;

  SELECT coalesce(array_agg(vault_secret_id),'{}'::uuid[]) INTO v_secret_ids
  FROM public.client_epl_credentials WHERE client_id=p_client_id AND organization_id=v_org;
  DELETE FROM public.client_epl_credentials WHERE client_id=p_client_id AND organization_id=v_org;
  IF array_length(v_secret_ids,1) IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = ANY(v_secret_ids); END IF;

  DELETE FROM public.shipments WHERE organization_id=v_org AND (client_id=p_client_id OR case_id IN (SELECT id FROM public.cases WHERE client_id=p_client_id AND organization_id=v_org));
  DELETE FROM public.registration_orders WHERE organization_id=v_org AND case_id IN (SELECT id FROM public.cases WHERE client_id=p_client_id AND organization_id=v_org);
  DELETE FROM public.documents WHERE organization_id=v_org AND case_id IN (SELECT id FROM public.cases WHERE client_id=p_client_id AND organization_id=v_org);
  DELETE FROM public.financial_transactions WHERE organization_id=v_org AND case_id IN (SELECT id FROM public.cases WHERE client_id=p_client_id AND organization_id=v_org);
  DELETE FROM public.permits WHERE organization_id=v_org AND case_id IN (SELECT id FROM public.cases WHERE client_id=p_client_id AND organization_id=v_org);
  DELETE FROM public.customs_declarations WHERE organization_id=v_org AND case_id IN (SELECT id FROM public.cases WHERE client_id=p_client_id AND organization_id=v_org);
  DELETE FROM public.cases WHERE client_id=p_client_id AND organization_id=v_org;
  DELETE FROM public.profiles WHERE client_id=p_client_id AND organization_id=v_org;
  DELETE FROM public.clients WHERE id=p_client_id AND organization_id=v_org;
END; $$;
REVOKE EXECUTE ON FUNCTION public.delete_client_workflow(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_client_workflow(uuid) TO authenticated;
