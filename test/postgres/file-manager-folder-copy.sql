\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('test.user_id', true), '')::uuid $$;

CREATE TABLE public.file_manager_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  parent_id uuid NULL,
  folder_key text NOT NULL,
  folder_type text NOT NULL,
  display_name text NOT NULL,
  client_id uuid NULL,
  shipment_id uuid NULL,
  customs_office_id uuid NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (parent_id, organization_id)
    REFERENCES public.file_manager_folders(id, organization_id) ON DELETE CASCADE
);
CREATE TABLE public.file_manager_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  folder_id uuid NOT NULL,
  shipment_id uuid NULL,
  client_id uuid NULL,
  file_asset_id uuid NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes bigint NOT NULL DEFAULT 0,
  external_message_id text NULL,
  document_type text NOT NULL DEFAULT 'other',
  tags text[] NOT NULL DEFAULT '{}'::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_archived boolean NOT NULL DEFAULT false,
  shipment_document_id uuid NULL,
  customs_document_id uuid NULL,
  storage_path text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT file_manager_files_has_source_check CHECK (
    file_asset_id IS NOT NULL OR shipment_document_id IS NOT NULL OR customs_document_id IS NOT NULL
  ),
  FOREIGN KEY (folder_id, organization_id)
    REFERENCES public.file_manager_folders(id, organization_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, file_asset_id)
);
CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('test.organization_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.user_role()
RETURNS text LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE OR REPLACE FUNCTION public.user_client_id()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('test.client_id', true), '')::uuid $$;

-- The real search function has many application joins. This schema-contract stub
-- preserves its signature and exact migration anchor to test the replacement safely.
CREATE OR REPLACE FUNCTION public.search_file_manager(
  p_query text, p_limit integer DEFAULT 50
)
RETURNS TABLE(entity_type text, entity_id uuid, title text, details text, folder_id uuid, shipment_id uuid, client_id uuid)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 'file'::text, fm.id, fm.original_name,
         concat_ws(' • ', fm.mime_type, fm.size_bytes::text),
         fm.folder_id, fm.shipment_id, fm.client_id
  FROM public.file_manager_files fm
  WHERE fm.organization_id = public.user_org_id()
    and not fm.is_archived
    and fm.original_name ILIKE '%' || trim(coalesce(p_query, '')) || '%'
  ORDER BY fm.created_at DESC
  LIMIT p_limit
$function$;

\i supabase/migrations/20261024174637_file_manager_folder_copy.sql

SELECT set_config('test.user_id', '20000000-0000-4000-8000-000000000001', false);
SELECT set_config('test.organization_id', '10000000-0000-4000-8000-000000000001', false);
SELECT set_config('test.role', 'owner', false);
SELECT set_config('test.client_id', '30000000-0000-4000-8000-000000000001', false);

INSERT INTO public.file_manager_folders
  (id, organization_id, parent_id, folder_key, folder_type, display_name, client_id, shipment_id, customs_office_id, is_system)
VALUES
  ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',NULL,'owners-root','root','صاحبان کالا',NULL,NULL,NULL,true),
  ('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','client:1','client','صاحب کالا','30000000-0000-4000-8000-000000000001',NULL,NULL,true),
  ('60000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','shipment:1','shipment','محموله گندم','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',true),
  ('60000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003','accounting-finance','accounting_finance','حسابداری مالی','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',true),
  ('60000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003','custom:invoices','custom','فاکتورها','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',false),
  ('60000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000005','custom:pdf','custom','PDF','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',false);

INSERT INTO public.file_manager_files
  (id, organization_id, folder_id, shipment_id, client_id, file_asset_id, original_name, mime_type, size_bytes, document_type, tags, metadata, storage_path, created_by)
VALUES
  ('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','invoice.pdf','application/pdf',7,'invoice',ARRAY['invoice'],'{}',NULL,'20000000-0000-4000-8000-000000000001');

SELECT public.copy_file_manager_folder(
  '60000000-0000-4000-8000-000000000005',
  '60000000-0000-4000-8000-000000000004',
  NULL
);

DO $test$
DECLARE
  v_copy_root uuid;
  v_copy_child uuid;
  v_alias record;
  v_count integer;
BEGIN
  SELECT id INTO v_copy_root
  FROM public.file_manager_folders
  WHERE parent_id='60000000-0000-4000-8000-000000000004' AND folder_key LIKE 'custom:copy:%';
  IF v_copy_root IS NULL THEN RAISE EXCEPTION 'TEST_COPY_ROOT_MISSING'; END IF;

  SELECT id INTO v_copy_child FROM public.file_manager_folders
  WHERE parent_id=v_copy_root AND display_name='PDF';
  IF v_copy_child IS NULL THEN RAISE EXCEPTION 'TEST_COPY_CHILD_MISSING'; END IF;

  SELECT * INTO v_alias FROM public.file_manager_files
  WHERE folder_id=v_copy_child AND metadata ? 'copyAliasSourceFileId';
  IF v_alias.id IS NULL THEN RAISE EXCEPTION 'TEST_FILE_ALIAS_MISSING'; END IF;
  IF v_alias.file_asset_id IS NOT NULL THEN RAISE EXCEPTION 'TEST_ALIAS_DUPLICATED_BINARY_REFERENCE'; END IF;
  IF v_alias.storage_path <> 'telegram://80000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'TEST_ALIAS_RECOVERY_PATH_INVALID'; END IF;
  IF v_alias.metadata->>'copyAliasFileAssetId' <> '80000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'TEST_ALIAS_ASSET_METADATA_MISSING'; END IF;

  SELECT count(*) INTO v_count FROM public.file_manager_files
  WHERE id='70000000-0000-4000-8000-000000000001' AND file_asset_id='80000000-0000-4000-8000-000000000001' AND storage_path IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'TEST_ORIGINAL_FILE_CHANGED'; END IF;

  SELECT count(*) INTO v_count FROM public.search_file_manager('invoice',50) WHERE title='invoice.pdf';
  IF v_count <> 1 THEN RAISE EXCEPTION 'TEST_SEARCH_ALIAS_DUPLICATE: % hits',v_count; END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.copy_file_manager_folder(uuid,uuid,text)'::regprocedure) THEN RAISE EXCEPTION 'TEST_COPY_RPC_NOT_SECURITY_DEFINER'; END IF;
  IF has_function_privilege('anon','public.copy_file_manager_folder(uuid,uuid,text)','execute') THEN RAISE EXCEPTION 'TEST_ANON_CAN_COPY_FOLDER'; END IF;
  IF NOT has_function_privilege('authenticated','public.copy_file_manager_folder(uuid,uuid,text)','execute') THEN RAISE EXCEPTION 'TEST_AUTHENTICATED_CANNOT_COPY_FOLDER'; END IF;
END
$test$;

SELECT set_config('test.role','client',false);
SELECT set_config('test.client_id','30000000-0000-4000-8000-000000000002',false);
DO $scope$
BEGIN
  BEGIN
    PERFORM public.copy_file_manager_folder('60000000-0000-4000-8000-000000000005','60000000-0000-4000-8000-000000000004',NULL);
    RAISE EXCEPTION 'TEST_CLIENT_CROSS_SCOPE_COPY_WAS_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    IF position('FILE_MANAGER_COPY_CLIENT_SCOPE_FORBIDDEN' in SQLERRM)=0 THEN RAISE; END IF;
  END;
END
$scope$;

SELECT set_config('test.role','owner',false);
SELECT set_config('test.organization_id','10000000-0000-4000-8000-000000000002',false);
DO $org$
BEGIN
  BEGIN
    PERFORM public.copy_file_manager_folder('60000000-0000-4000-8000-000000000005','60000000-0000-4000-8000-000000000004',NULL);
    RAISE EXCEPTION 'TEST_CROSS_ORG_COPY_WAS_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    IF position('FILE_MANAGER_COPY_SOURCE_NOT_FOUND' in SQLERRM)=0 THEN RAISE; END IF;
  END;
END
$org$;

SELECT 'File-manager copy migration integration test passed' AS result;
