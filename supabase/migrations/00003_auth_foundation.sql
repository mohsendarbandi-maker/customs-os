CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL CHECK (char_length(trim(name)) >= 2),
    economic_code VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'broker',
    client_id UUID,
    full_name VARCHAR(255) NOT NULL CHECK (char_length(trim(full_name)) >= 2),
    phone VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_profiles_tenant UNIQUE (id, organization_id),
    CONSTRAINT chk_profile_client_role CHECK (
        (role = 'client' AND client_id IS NOT NULL) OR 
        (role <> 'client' AND client_id IS NULL)
    )
);

CREATE OR REPLACE FUNCTION auth.user_org_id() 
RETURNS UUID 
LANGUAGE sql 
STABLE 
SECURITY DEFINER 
SET search_path = public, pg_temp 
AS $$
  SELECT organization_id FROM profiles WHERE id = auth.uid() AND is_active = TRUE;
$$;

CREATE OR REPLACE FUNCTION auth.user_role() 
RETURNS user_role 
LANGUAGE sql 
STABLE 
SECURITY DEFINER 
SET search_path = public, pg_temp 
AS $$
  SELECT role FROM profiles WHERE id = auth.uid() AND is_active = TRUE;
$$;

CREATE OR REPLACE FUNCTION auth.user_client_id() 
RETURNS UUID 
LANGUAGE sql 
STABLE 
SECURITY DEFINER 
SET search_path = public, pg_temp 
AS $$
  SELECT client_id FROM profiles WHERE id = auth.uid() AND is_active = TRUE;
$$;

CREATE OR REPLACE FUNCTION public.create_tenant_account(org_name TEXT, user_full_name TEXT)
RETURNS UUID 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, pg_temp 
AS $$
DECLARE
    new_org_id UUID;
    clean_org_name TEXT;
    clean_user_name TEXT;
BEGIN
    IF auth.uid() IS NULL THEN 
        RAISE EXCEPTION 'Authentication required to initialize tenant'; 
    END IF;

    clean_org_name := trim(org_name);
    clean_user_name := trim(user_full_name);

    IF char_length(clean_org_name) < 2 OR char_length(clean_org_name) > 255 THEN 
        RAISE EXCEPTION 'Organization name must be between 2 and 255 characters'; 
    END IF;

    IF char_length(clean_user_name) < 2 OR char_length(clean_user_name) > 255 THEN 
        RAISE EXCEPTION 'Full name must be between 2 and 255 characters'; 
    END IF;

    IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()) THEN 
        RAISE EXCEPTION 'User profile already exists in an organization'; 
    END IF;

    INSERT INTO organizations (name) 
    VALUES (clean_org_name) 
    RETURNING id INTO new_org_id;

    INSERT INTO profiles (id, organization_id, role, full_name, is_active, client_id) 
    VALUES (auth.uid(), new_org_id, 'owner', clean_user_name, TRUE, NULL);
    
    RETURN new_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant_account(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tenant_account(TEXT, TEXT) TO authenticated;
