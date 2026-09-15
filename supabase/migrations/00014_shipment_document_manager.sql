-- Shipment is the primary business entity; customs case is optional/later.
ALTER TABLE public.shipments ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE public.cases ALTER COLUMN case_number DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.shipment_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  document_name text not null,
  original_file_name text not null,
  storage_path text not null,
  mime_type text not null,
  file_size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS idx_shipment_documents_shipment ON public.shipment_documents(shipment_id,created_at desc);
ALTER TABLE public.shipment_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipment_documents_select ON public.shipment_documents;
DROP POLICY IF EXISTS shipment_documents_insert ON public.shipment_documents;
DROP POLICY IF EXISTS shipment_documents_update ON public.shipment_documents;
DROP POLICY IF EXISTS shipment_documents_delete ON public.shipment_documents;
CREATE POLICY shipment_documents_select ON public.shipment_documents FOR SELECT USING (organization_id=public.user_org_id());
CREATE POLICY shipment_documents_insert ON public.shipment_documents FOR INSERT WITH CHECK (organization_id=public.user_org_id());
CREATE POLICY shipment_documents_update ON public.shipment_documents FOR UPDATE USING (organization_id=public.user_org_id()) WITH CHECK (organization_id=public.user_org_id());
CREATE POLICY shipment_documents_delete ON public.shipment_documents FOR DELETE USING (organization_id=public.user_org_id());

DROP POLICY IF EXISTS shipment_documents_storage_insert ON storage.objects;
CREATE POLICY shipment_documents_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='customs_documents' AND split_part(name,'/',1)=public.user_org_id()::text);
DROP POLICY IF EXISTS shipment_documents_storage_select ON storage.objects;
CREATE POLICY shipment_documents_storage_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id='customs_documents' AND split_part(name,'/',1)=public.user_org_id()::text);

CREATE OR REPLACE FUNCTION public.touch_shipment_documents_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_shipment_documents_updated_at ON public.shipment_documents;
CREATE TRIGGER trg_shipment_documents_updated_at BEFORE UPDATE ON public.shipment_documents FOR EACH ROW EXECUTE FUNCTION public.touch_shipment_documents_updated_at();

-- Do not manufacture CASE-... as a user-facing identifier.
CREATE OR REPLACE FUNCTION public.create_case_workflow(p_client_name text,p_registration_order_no text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_org_id uuid; v_client_id uuid; v_case_id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 v_org_id:=public.user_org_id();
 IF v_org_id IS NULL THEN RAISE EXCEPTION 'User organization not found'; END IF;
 IF public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'User role is not allowed to create cases'; END IF;
 IF nullif(trim(p_client_name),'') IS NULL THEN RAISE EXCEPTION 'Client name is required'; END IF;
 IF nullif(trim(p_registration_order_no),'') IS NOT NULL THEN
  SELECT c.id INTO v_case_id FROM public.cases c WHERE c.organization_id=v_org_id AND c.registration_order_no=trim(p_registration_order_no) ORDER BY c.created_at LIMIT 1;
  IF v_case_id IS NOT NULL THEN RETURN v_case_id; END IF;
 END IF;
 SELECT c.id INTO v_client_id FROM public.clients c WHERE c.organization_id=v_org_id AND lower(trim(c.name))=lower(trim(p_client_name)) ORDER BY c.created_at LIMIT 1;
 IF v_client_id IS NULL THEN INSERT INTO public.clients(organization_id,name) VALUES(v_org_id,trim(p_client_name)) RETURNING id INTO v_client_id; END IF;
 INSERT INTO public.cases(organization_id,client_id,case_number,status,registration_order_no) VALUES(v_org_id,v_client_id,NULL,'draft',nullif(trim(p_registration_order_no),'')) RETURNING id INTO v_case_id;
 IF nullif(trim(p_registration_order_no),'') IS NOT NULL THEN UPDATE public.cases SET status='registration_order' WHERE id=v_case_id; END IF;
 RETURN v_case_id;
END; $$;
REVOKE ALL ON FUNCTION public.create_case_workflow(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_case_workflow(text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_case_workflow(text,text) TO authenticated;