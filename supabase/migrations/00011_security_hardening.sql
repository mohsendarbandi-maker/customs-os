-- ============================================================
-- 00011 SECURITY HARDENING
-- Reconciles live Supabase security with the application model.
-- Applied to the live database on 2026-09-12 before being recorded here.
-- ============================================================

-- All exposed application policies are authenticated-only.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I TO authenticated',
      r.policyname, r.schemaname, r.tablename
    );
  END LOOP;
END $$;

-- Replace deprecated auth.role() reference-data policies.
DROP POLICY IF EXISTS global_select_customs_offices ON public.customs_offices;
DROP POLICY IF EXISTS global_select_hs_codes ON public.hs_codes;

CREATE POLICY global_select_customs_offices
ON public.customs_offices FOR SELECT TO authenticated
USING (true);

CREATE POLICY global_select_hs_codes
ON public.hs_codes FOR SELECT TO authenticated
USING (true);

-- Storage policies are authenticated-only and organization-scoped.
DROP POLICY IF EXISTS "Employees can upload to quarantine" ON storage.objects;
DROP POLICY IF EXISTS "Employees can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Owners and admins can delete files" ON storage.objects;
DROP POLICY IF EXISTS "Owners and admins can update files" ON storage.objects;
DROP POLICY IF EXISTS "Users can read authorized organization documents" ON storage.objects;

CREATE POLICY "Employees can upload to quarantine"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'customs_quarantine'
  AND user_role() IN ('owner','admin','broker','accountant','warehouse')
  AND split_part(name,'/',1) = user_org_id()::text
  AND (
    lower(right(name,4)) IN ('.pdf','.jpg','.png')
    OR lower(right(name,5)) = '.jpeg'
  )
);

CREATE POLICY "Employees can upload documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'customs_documents'
  AND user_role() IN ('owner','admin','broker','accountant','warehouse')
  AND split_part(name,'/',1) = user_org_id()::text
  AND (
    lower(right(name,4)) IN ('.pdf','.jpg','.png')
    OR lower(right(name,5)) = '.jpeg'
  )
);

CREATE POLICY "Users can read authorized organization documents"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'customs_documents'
  AND EXISTS (
    SELECT 1
    FROM public.documents d
    WHERE d.storage_path = storage.objects.name
      AND d.organization_id = user_org_id()
  )
);

CREATE POLICY "Owners and admins can update files"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'customs_documents'
  AND user_role() IN ('owner','admin')
  AND split_part(name,'/',1) = user_org_id()::text
)
WITH CHECK (
  bucket_id = 'customs_documents'
  AND user_role() IN ('owner','admin')
  AND split_part(name,'/',1) = user_org_id()::text
);

CREATE POLICY "Owners and admins can delete files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'customs_documents'
  AND user_role() IN ('owner','admin')
  AND split_part(name,'/',1) = user_org_id()::text
);

-- SECURITY DEFINER helpers must never be callable by anonymous users.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'audit_case_status_change','create_tenant_account',
        'prevent_audit_tampering','prevent_org_id_mutation',
        'prevent_organization_deletion','prevent_profile_deletion',
        'prevent_profile_tampering','record_audit_event',
        'trigger_set_updated_at','user_client_id','user_org_id',
        'user_role','validate_case_assigned_broker'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.args);
  END LOOP;
END $$;

-- Only these four functions are application RPC/helpers.
GRANT EXECUTE ON FUNCTION public.create_tenant_account(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_client_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_role() TO authenticated;
