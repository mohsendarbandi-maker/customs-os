-- Let client users read workflow records only for declarations tied to their own cargo.
DROP POLICY IF EXISTS customs_declaration_workflow_select ON public.customs_declaration_workflow;

CREATE POLICY customs_declaration_workflow_select ON public.customs_declaration_workflow
  FOR SELECT TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND (
      public.user_role() = ANY (ARRAY[
        'owner'::public.user_role,
        'admin'::public.user_role,
        'broker'::public.user_role,
        'warehouse'::public.user_role,
        'accountant'::public.user_role
      ])
      OR (
        public.user_role() = 'client'::public.user_role
        AND EXISTS (
          SELECT 1
          FROM public.customs_declarations d
          WHERE d.id = customs_declaration_workflow.declaration_id
            AND d.organization_id = customs_declaration_workflow.organization_id
            AND (
              EXISTS (
                SELECT 1 FROM public.shipments s
                WHERE s.id = d.shipment_id
                  AND s.organization_id = d.organization_id
                  AND s.client_id = public.user_client_id()
              )
              OR EXISTS (
                SELECT 1 FROM public.cases c
                WHERE c.id = d.case_id
                  AND c.organization_id = d.organization_id
                  AND c.client_id = public.user_client_id()
              )
            )
        )
      )
    )
  );
