ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customs_offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE hs_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customs_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. Reference Data (Global Read-Only)
CREATE POLICY "global_select_customs_offices" ON customs_offices FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "global_select_hs_codes" ON hs_codes FOR SELECT USING (auth.role() = 'authenticated');

-- 2. Organizations
CREATE POLICY "org_select" ON organizations FOR SELECT USING (id = auth.user_org_id());
CREATE POLICY "org_update" ON organizations FOR UPDATE 
  USING (id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin'))
  WITH CHECK (id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin'));

-- 3. Profiles
CREATE POLICY "profiles_select" ON profiles FOR SELECT 
  USING (
    organization_id = auth.user_org_id() AND (
      auth.user_role() <> 'client' 
      OR (client_id IS NOT NULL AND client_id = auth.user_client_id())
      OR id IN (
        SELECT c.assigned_broker_id 
        FROM cases c 
        WHERE c.client_id = auth.user_client_id() 
          AND c.assigned_broker_id IS NOT NULL
      )
    )
  );

CREATE POLICY "profiles_update_self" ON profiles FOR UPDATE 
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND organization_id = auth.user_org_id());

CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin'))
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin'));

-- 4. Audit Logs
CREATE POLICY "audit_select" ON audit_logs FOR SELECT 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin'));

-- 5. Clients
CREATE POLICY "clients_select" ON clients FOR SELECT 
  USING (organization_id = auth.user_org_id() AND (auth.user_role() <> 'client' OR id = auth.user_client_id()));
CREATE POLICY "clients_insert" ON clients FOR INSERT 
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'));
CREATE POLICY "clients_update" ON clients FOR UPDATE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'))
  WITH CHECK (organization_id = auth.user_org_id());
CREATE POLICY "clients_delete" ON clients FOR DELETE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin'));

-- 6. Vessels
CREATE POLICY "vessels_select" ON vessels FOR SELECT 
  USING (organization_id = auth.user_org_id() AND auth.user_role() <> 'client');
CREATE POLICY "vessels_insert" ON vessels FOR INSERT 
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'));
CREATE POLICY "vessels_update" ON vessels FOR UPDATE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'))
  WITH CHECK (organization_id = auth.user_org_id());
CREATE POLICY "vessels_delete" ON vessels FOR DELETE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin'));

-- 7. Cases
CREATE POLICY "cases_select" ON cases FOR SELECT 
  USING (organization_id = auth.user_org_id() AND (auth.user_role() <> 'client' OR client_id = auth.user_client_id()));
CREATE POLICY "cases_insert" ON cases FOR INSERT 
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'));
CREATE POLICY "cases_update" ON cases FOR UPDATE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'))
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'));
CREATE POLICY "cases_delete" ON cases FOR DELETE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin') AND status = 'draft');

-- 8. Case Status History
CREATE POLICY "status_history_select" ON case_status_history FOR SELECT 
  USING (
    organization_id = auth.user_org_id() AND 
    (auth.user_role() <> 'client' OR EXISTS (
      SELECT 1 FROM cases WHERE cases.id = case_status_history.case_id AND cases.client_id = auth.user_client_id()
    ))
  );

-- 9. Shipments
CREATE POLICY "shipments_select" ON shipments FOR SELECT 
  USING (
    organization_id = auth.user_org_id() AND 
    (auth.user_role() <> 'client' OR EXISTS (
      SELECT 1 FROM cases WHERE cases.id = shipments.case_id AND cases.client_id = auth.user_client_id()
    ))
  );
CREATE POLICY "shipments_insert" ON shipments FOR INSERT 
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'));
CREATE POLICY "shipments_update" ON shipments FOR UPDATE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'))
  WITH CHECK (organization_id = auth.user_org_id());
CREATE POLICY "shipments_delete" ON shipments FOR DELETE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin'));

-- 10. Containers
CREATE POLICY "containers_select" ON containers FOR SELECT 
  USING (
    organization_id = auth.user_org_id() AND 
    (auth.user_role() <> 'client' OR EXISTS (
      SELECT 1 FROM shipments 
      JOIN cases ON cases.id = shipments.case_id 
      WHERE shipments.id = containers.shipment_id AND cases.client_id = auth.user_client_id()
    ))
  );
CREATE POLICY "containers_insert" ON containers FOR INSERT 
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker', 'warehouse'));
CREATE POLICY "containers_update" ON containers FOR UPDATE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker', 'warehouse'))
  WITH CHECK (organization_id = auth.user_org_id());
CREATE POLICY "containers_delete" ON containers FOR DELETE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin'));

-- 11. Customs Declarations
CREATE POLICY "declarations_select" ON customs_declarations FOR SELECT 
  USING (
    organization_id = auth.user_org_id() AND 
    (auth.user_role() <> 'client' OR EXISTS (
      SELECT 1 FROM cases WHERE cases.id = customs_declarations.case_id AND cases.client_id = auth.user_client_id()
    ))
  );
CREATE POLICY "declarations_insert" ON customs_declarations FOR INSERT 
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'));
CREATE POLICY "declarations_update" ON customs_declarations FOR UPDATE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'))
  WITH CHECK (organization_id = auth.user_org_id());
CREATE POLICY "declarations_delete" ON customs_declarations FOR DELETE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin'));

-- 12. Permits
CREATE POLICY "permits_select" ON permits FOR SELECT 
  USING (
    organization_id = auth.user_org_id() AND 
    (auth.user_role() <> 'client' OR EXISTS (
      SELECT 1 FROM cases WHERE cases.id = permits.case_id AND cases.client_id = auth.user_client_id()
    ))
  );
CREATE POLICY "permits_insert" ON permits FOR INSERT 
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'));
CREATE POLICY "permits_update" ON permits FOR UPDATE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'))
  WITH CHECK (organization_id = auth.user_org_id());
CREATE POLICY "permits_delete" ON permits FOR DELETE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin'));

-- 13. Financial Transactions
CREATE POLICY "finance_select" ON financial_transactions FOR SELECT 
  USING (
    organization_id = auth.user_org_id() AND (
      auth.user_role() IN ('owner', 'admin', 'accountant', 'broker') OR 
      (auth.user_role() = 'client' AND EXISTS (
        SELECT 1 FROM cases WHERE cases.id = financial_transactions.case_id AND cases.client_id = auth.user_client_id()
      ))
    )
  );
CREATE POLICY "finance_insert" ON financial_transactions FOR INSERT 
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'accountant'));
CREATE POLICY "finance_update" ON financial_transactions FOR UPDATE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'accountant'))
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'accountant'));

-- 14. Documents
CREATE POLICY "documents_select" ON documents FOR SELECT 
  USING (
    organization_id = auth.user_org_id() AND 
    (auth.user_role() <> 'client' OR EXISTS (
      SELECT 1 FROM cases WHERE cases.id = documents.case_id AND cases.client_id = auth.user_client_id()
    ))
  );
CREATE POLICY "documents_insert" ON documents FOR INSERT 
  WITH CHECK (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker', 'accountant', 'warehouse'));
CREATE POLICY "documents_update" ON documents FOR UPDATE 
  USING (organization_id = auth.user_org_id() AND auth.user_role() IN ('owner', 'admin', 'broker'))
  WITH CHECK (organization_id = auth.user_org_id());
CREATE POLICY "documents_delete" ON documents FOR DELETE 
  USING (organization_id = auth.user_org_id() AND (auth.user_role() IN ('owner', 'admin') OR uploaded_by = auth.uid()));
