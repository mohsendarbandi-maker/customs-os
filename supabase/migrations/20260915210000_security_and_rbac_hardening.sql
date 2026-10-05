-- Customs OS: security/RBAC hardening for shipment documents, directories and audit writes.
-- Applied to production Supabase on 2026-09-15.

DROP POLICY IF EXISTS shipment_documents_select ON public.shipment_documents;
DROP POLICY IF EXISTS shipment_documents_insert ON public.shipment_documents;
DROP POLICY IF EXISTS shipment_documents_update ON public.shipment_documents;
DROP POLICY IF EXISTS shipment_documents_delete ON public.shipment_documents;
CREATE POLICY shipment_documents_select ON public.shipment_documents FOR SELECT TO authenticated USING (organization_id = public.user_org_id() AND (public.user_role() <> 'client'::public.user_role OR EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_documents.shipment_id AND s.organization_id = public.user_org_id() AND s.client_id = public.user_client_id())));
CREATE POLICY shipment_documents_insert ON public.shipment_documents FOR INSERT TO authenticated WITH CHECK (organization_id = public.user_org_id() AND (public.user_role() <> 'client'::public.user_role OR EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_documents.shipment_id AND s.organization_id = public.user_org_id() AND s.client_id = public.user_client_id())));
CREATE POLICY shipment_documents_update ON public.shipment_documents FOR UPDATE TO authenticated USING (organization_id = public.user_org_id() AND (public.user_role() <> 'client'::public.user_role OR EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_documents.shipment_id AND s.organization_id = public.user_org_id() AND s.client_id = public.user_client_id()))) WITH CHECK (organization_id = public.user_org_id() AND (public.user_role() <> 'client'::public.user_role OR EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_documents.shipment_id AND s.organization_id = public.user_org_id() AND s.client_id = public.user_client_id())));
CREATE POLICY shipment_documents_delete ON public.shipment_documents FOR DELETE TO authenticated USING (organization_id = public.user_org_id() AND public.user_role() IN ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role));

DROP POLICY IF EXISTS shipment_doc_extractions_select ON public.shipment_document_extractions;
DROP POLICY IF EXISTS shipment_doc_extractions_insert ON public.shipment_document_extractions;
DROP POLICY IF EXISTS shipment_doc_extractions_update ON public.shipment_document_extractions;
DROP POLICY IF EXISTS shipment_doc_extractions_delete ON public.shipment_document_extractions;
CREATE POLICY shipment_doc_extractions_select ON public.shipment_document_extractions FOR SELECT TO authenticated USING (organization_id = public.user_org_id() AND (public.user_role() <> 'client'::public.user_role OR EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_document_extractions.shipment_id AND s.organization_id = public.user_org_id() AND s.client_id = public.user_client_id())));
CREATE POLICY shipment_doc_extractions_insert ON public.shipment_document_extractions FOR INSERT TO authenticated WITH CHECK (organization_id = public.user_org_id() AND (public.user_role() <> 'client'::public.user_role OR EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_document_extractions.shipment_id AND s.organization_id = public.user_org_id() AND s.client_id = public.user_client_id())));
CREATE POLICY shipment_doc_extractions_update ON public.shipment_document_extractions FOR UPDATE TO authenticated USING (organization_id = public.user_org_id() AND (public.user_role() <> 'client'::public.user_role OR EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_document_extractions.shipment_id AND s.organization_id = public.user_org_id() AND s.client_id = public.user_client_id()))) WITH CHECK (organization_id = public.user_org_id() AND (public.user_role() <> 'client'::public.user_role OR EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_document_extractions.shipment_id AND s.organization_id = public.user_org_id() AND s.client_id = public.user_client_id())));
CREATE POLICY shipment_doc_extractions_delete ON public.shipment_document_extractions FOR DELETE TO authenticated USING (organization_id = public.user_org_id() AND public.user_role() IN ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role));

DROP POLICY IF EXISTS shipping_lines_select ON public.shipping_lines;
DROP POLICY IF EXISTS shipping_lines_insert ON public.shipping_lines;
DROP POLICY IF EXISTS shipping_lines_update ON public.shipping_lines;
DROP POLICY IF EXISTS shipping_lines_delete ON public.shipping_lines;
CREATE POLICY shipping_lines_select ON public.shipping_lines FOR SELECT TO authenticated USING (organization_id = public.user_org_id() AND public.user_role() <> 'client'::public.user_role);
CREATE POLICY shipping_lines_insert ON public.shipping_lines FOR INSERT TO authenticated WITH CHECK (organization_id = public.user_org_id() AND public.user_role() IN ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role));
CREATE POLICY shipping_lines_update ON public.shipping_lines FOR UPDATE TO authenticated USING (organization_id = public.user_org_id() AND public.user_role() IN ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role)) WITH CHECK (organization_id = public.user_org_id() AND public.user_role() IN ('owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role));
CREATE POLICY shipping_lines_delete ON public.shipping_lines FOR DELETE TO authenticated USING (organization_id = public.user_org_id() AND public.user_role() IN ('owner'::public.user_role,'admin'::public.user_role));

DROP POLICY IF EXISTS shipment_documents_storage_select ON storage.objects;
CREATE POLICY shipment_documents_storage_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'customs_documents' AND split_part(name, '/', 1) = public.user_org_id()::text AND (public.user_role() <> 'client'::public.user_role OR EXISTS (SELECT 1 FROM public.shipments s WHERE s.id::text = split_part(name, '/', 2) AND s.organization_id = public.user_org_id() AND s.client_id = public.user_client_id())));
DROP POLICY IF EXISTS shipment_documents_storage_insert ON storage.objects;
CREATE POLICY shipment_documents_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'customs_documents' AND split_part(name, '/', 1) = public.user_org_id()::text AND (public.user_role() <> 'client'::public.user_role OR EXISTS (SELECT 1 FROM public.shipments s WHERE s.id::text = split_part(name, '/', 2) AND s.organization_id = public.user_org_id() AND s.client_id = public.user_client_id())));

REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM anon, authenticated;
