-- Keep customs offices as shared reference data, instead of allowing each organization
-- to maintain an incompatible list of national customs-office codes.
DROP POLICY IF EXISTS customs_offices_insert ON public.customs_offices;
DROP POLICY IF EXISTS customs_offices_update ON public.customs_offices;
DROP POLICY IF EXISTS customs_offices_delete ON public.customs_offices;

CREATE POLICY customs_offices_insert ON public.customs_offices
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IS NULL
    AND public.user_role() = 'owner'::public.user_role
  );

CREATE POLICY customs_offices_update ON public.customs_offices
  FOR UPDATE TO authenticated
  USING (
    public.user_role() = 'owner'::public.user_role
    AND (organization_id IS NULL OR organization_id = public.user_org_id())
  )
  WITH CHECK (
    public.user_role() = 'owner'::public.user_role
    AND (organization_id IS NULL OR organization_id = public.user_org_id())
  );

CREATE POLICY customs_offices_delete ON public.customs_offices
  FOR DELETE TO authenticated
  USING (
    public.user_role() = 'owner'::public.user_role
    AND (organization_id IS NULL OR organization_id = public.user_org_id())
  );
