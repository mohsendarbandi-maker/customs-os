CREATE OR REPLACE FUNCTION trigger_set_updated_at() 
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_org_id_mutation() 
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id is strictly immutable once assigned';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_profile_tampering() 
RETURNS TRIGGER AS $$
DECLARE
  v_caller_role user_role;
BEGIN
  IF NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'Users cannot change organization association';
  END IF;

  IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    IF auth.user_role() NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'Only administrators can alter client associations';
    END IF;
  END IF;

  IF NEW.is_active <> OLD.is_active THEN
    IF auth.user_role() NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'Only administrators can toggle user active status';
    END IF;
  END IF;

  IF NEW.role <> OLD.role THEN
    v_caller_role := auth.user_role();
    IF v_caller_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'Unauthorized attempt to modify role';
    END IF;

    IF (NEW.role = 'owner' OR OLD.role = 'owner') AND v_caller_role <> 'owner' THEN
      RAISE EXCEPTION 'Only an existing owner can grant or revoke owner status';
    END IF;
  END IF;

  IF OLD.role = 'owner' AND (NEW.role <> 'owner' OR NEW.is_active = FALSE) THEN
    IF (
      SELECT COUNT(*) 
      FROM profiles 
      WHERE organization_id = OLD.organization_id 
        AND role = 'owner' 
        AND is_active = TRUE 
        AND id <> OLD.id
    ) < 1 THEN
      RAISE EXCEPTION 'Cannot demote or deactivate the last active owner in the organization';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION prevent_profile_deletion() 
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Profiles cannot be deleted through application operations. Deactivate the user instead.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_organization_deletion() 
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Organizations cannot be deleted through application operations.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_case_assigned_broker() 
RETURNS TRIGGER AS $$
DECLARE
  v_role user_role;
BEGIN
  IF NEW.assigned_broker_id IS NOT NULL THEN
    SELECT role INTO v_role 
    FROM profiles 
    WHERE id = NEW.assigned_broker_id AND organization_id = NEW.organization_id;

    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Assigned broker does not exist in this organization';
    END IF;

    IF v_role NOT IN ('owner', 'admin', 'broker') THEN
      RAISE EXCEPTION 'Assigned broker must possess owner, admin, or broker role. Role found: %', v_role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION audit_case_status_change() 
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO case_status_history (
      organization_id, 
      case_id, 
      previous_status, 
      new_status, 
      changed_by
    ) VALUES (
      NEW.organization_id, 
      NEW.id, 
      OLD.status, 
      NEW.status, 
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION record_audit_event() 
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_record_id UUID;
  v_old JSONB := NULL;
  v_new JSONB := NULL;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_org_id := OLD.organization_id;
    v_record_id := OLD.id;
    v_old := to_jsonb(OLD);
  ELSIF TG_OP = 'UPDATE' THEN
    v_org_id := NEW.organization_id;
    v_record_id := NEW.id;
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'INSERT' THEN
    v_org_id := NEW.organization_id;
    v_record_id := NEW.id;
    v_new := to_jsonb(NEW);
  END IF;

  INSERT INTO audit_logs (
    organization_id,
    user_id,
    action,
    table_name,
    record_id,
    old_data,
    new_data
  ) VALUES (
    v_org_id,
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_record_id,
    v_old,
    v_new
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION prevent_audit_tampering() 
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit records and status histories are strictly immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_profile_tamper_guard 
BEFORE UPDATE ON profiles 
FOR EACH ROW EXECUTE PROCEDURE prevent_profile_tampering();

CREATE TRIGGER tr_profile_no_delete 
BEFORE DELETE ON profiles 
FOR EACH ROW EXECUTE PROCEDURE prevent_profile_deletion();

CREATE TRIGGER tr_org_no_delete 
BEFORE DELETE ON organizations 
FOR EACH ROW EXECUTE PROCEDURE prevent_organization_deletion();

CREATE TRIGGER tr_case_broker_validate 
BEFORE INSERT OR UPDATE OF assigned_broker_id ON cases 
FOR EACH ROW EXECUTE PROCEDURE validate_case_assigned_broker();

CREATE TRIGGER tr_case_status_audit 
AFTER UPDATE ON cases 
FOR EACH ROW EXECUTE PROCEDURE audit_case_status_change();

CREATE TRIGGER tr_audit_cases AFTER INSERT OR UPDATE OR DELETE ON cases FOR EACH ROW EXECUTE PROCEDURE record_audit_event();
CREATE TRIGGER tr_audit_clients AFTER INSERT OR UPDATE OR DELETE ON clients FOR EACH ROW EXECUTE PROCEDURE record_audit_event();
CREATE TRIGGER tr_audit_declarations AFTER INSERT OR UPDATE OR DELETE ON customs_declarations FOR EACH ROW EXECUTE PROCEDURE record_audit_event();
CREATE TRIGGER tr_audit_finance AFTER INSERT OR UPDATE OR DELETE ON financial_transactions FOR EACH ROW EXECUTE PROCEDURE record_audit_event();

CREATE TRIGGER tr_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE PROCEDURE prevent_audit_tampering();
CREATE TRIGGER tr_status_history_immutable BEFORE UPDATE OR DELETE ON case_status_history FOR EACH ROW EXECUTE PROCEDURE prevent_audit_tampering();

CREATE TRIGGER tr_upd_organizations BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
CREATE TRIGGER tr_upd_profiles BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
CREATE TRIGGER tr_upd_clients BEFORE UPDATE ON clients FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
CREATE TRIGGER tr_upd_cases BEFORE UPDATE ON cases FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
CREATE TRIGGER tr_upd_shipments BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
CREATE TRIGGER tr_upd_declarations BEFORE UPDATE ON customs_declarations FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
CREATE TRIGGER tr_upd_permits BEFORE UPDATE ON permits FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
CREATE TRIGGER tr_upd_finance BEFORE UPDATE ON financial_transactions FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();
CREATE TRIGGER tr_upd_documents BEFORE UPDATE ON documents FOR EACH ROW EXECUTE PROCEDURE trigger_set_updated_at();

CREATE TRIGGER tr_lock_org_profiles BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE PROCEDURE prevent_org_id_mutation();
CREATE TRIGGER tr_lock_org_clients BEFORE UPDATE ON clients FOR EACH ROW EXECUTE PROCEDURE prevent_org_id_mutation();
CREATE TRIGGER tr_lock_org_cases BEFORE UPDATE ON cases FOR EACH ROW EXECUTE PROCEDURE prevent_org_id_mutation();
CREATE TRIGGER tr_lock_org_shipments BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE PROCEDURE prevent_org_id_mutation();
CREATE TRIGGER tr_lock_org_containers BEFORE UPDATE ON containers FOR EACH ROW EXECUTE PROCEDURE prevent_org_id_mutation();
CREATE TRIGGER tr_lock_org_declarations BEFORE UPDATE ON customs_declarations FOR EACH ROW EXECUTE PROCEDURE prevent_org_id_mutation();
CREATE TRIGGER tr_lock_org_permits BEFORE UPDATE ON permits FOR EACH ROW EXECUTE PROCEDURE prevent_org_id_mutation();
CREATE TRIGGER tr_lock_org_finance BEFORE UPDATE ON financial_transactions FOR EACH ROW EXECUTE PROCEDURE prevent_org_id_mutation();
CREATE TRIGGER tr_lock_org_documents BEFORE UPDATE ON documents FOR EACH ROW EXECUTE PROCEDURE prevent_org_id_mutation();
