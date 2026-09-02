CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL CHECK (char_length(trim(name)) >= 2),
    economic_code VARCHAR(20),
    national_id VARCHAR(15),
    phone VARCHAR(20),
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_clients_tenant UNIQUE (id, organization_id),
    CONSTRAINT uq_clients_national_id_per_org UNIQUE (organization_id, national_id)
);

ALTER TABLE profiles 
ADD CONSTRAINT fk_profiles_client_tenant 
FOREIGN KEY (client_id, organization_id) 
REFERENCES clients(id, organization_id) 
ON DELETE RESTRICT;

CREATE TABLE cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_id UUID NOT NULL,
    assigned_broker_id UUID,
    customs_office_id UUID REFERENCES customs_offices(id) ON DELETE RESTRICT,
    case_number VARCHAR(100) NOT NULL,
    status case_status NOT NULL DEFAULT 'draft',
    registration_order_no VARCHAR(100),
    proforma_no VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cases_tenant UNIQUE (id, organization_id),
    CONSTRAINT uq_cases_number_per_org UNIQUE (organization_id, case_number),
    CONSTRAINT fk_cases_client_tenant 
        FOREIGN KEY (client_id, organization_id) 
        REFERENCES clients(id, organization_id) 
        ON DELETE RESTRICT,
    CONSTRAINT fk_cases_broker_tenant 
        FOREIGN KEY (assigned_broker_id, organization_id) 
        REFERENCES profiles(id, organization_id) 
        ON DELETE RESTRICT
);

CREATE TABLE case_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id UUID NOT NULL,
    changed_by UUID,
    previous_status case_status,
    new_status case_status NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_status_history_case_tenant 
        FOREIGN KEY (case_id, organization_id) 
        REFERENCES cases(id, organization_id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_status_history_user_tenant 
        FOREIGN KEY (changed_by, organization_id) 
        REFERENCES profiles(id, organization_id) 
        ON DELETE RESTRICT
);

CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id UUID NOT NULL,
    vessel_id UUID,
    transport_mode transport_mode NOT NULL,
    bill_of_lading_no VARCHAR(100),
    gross_weight_kg DECIMAL(12,2) CHECK (gross_weight_kg > 0),
    origin_port VARCHAR(100),
    destination_port VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shipments_tenant UNIQUE (id, organization_id),
    CONSTRAINT fk_shipments_case_tenant 
        FOREIGN KEY (case_id, organization_id) 
        REFERENCES cases(id, organization_id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_shipments_vessel_tenant 
        FOREIGN KEY (vessel_id, organization_id) 
        REFERENCES vessels(id, organization_id) 
        ON DELETE RESTRICT
);

CREATE TABLE containers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    shipment_id UUID NOT NULL,
    container_number VARCHAR(20) NOT NULL,
    size_type container_size NOT NULL,
    seal_number VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_containers_tenant UNIQUE (id, organization_id),
    CONSTRAINT fk_containers_shipment_tenant 
        FOREIGN KEY (shipment_id, organization_id) 
        REFERENCES shipments(id, organization_id) 
        ON DELETE CASCADE
);

CREATE TABLE customs_declarations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id UUID NOT NULL,
    customs_office_id UUID REFERENCES customs_offices(id) ON DELETE RESTRICT,
    kottaj_number VARCHAR(50) NOT NULL,
    declaration_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    customs_path VARCHAR(20) CHECK (customs_path IN ('green', 'yellow', 'red')),
    assessed_value_irr DECIMAL(18,2) CHECK (assessed_value_irr >= 0),
    total_duties_irr DECIMAL(18,2) CHECK (total_duties_irr >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_declarations_tenant UNIQUE (id, organization_id),
    CONSTRAINT uq_declarations_kottaj_per_org UNIQUE (organization_id, kottaj_number),
    CONSTRAINT fk_declarations_case_tenant 
        FOREIGN KEY (case_id, organization_id) 
        REFERENCES cases(id, organization_id) 
        ON DELETE CASCADE
);

CREATE TABLE permits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id UUID NOT NULL,
    permit_type VARCHAR(100) NOT NULL,
    permit_number VARCHAR(100),
    issuing_authority VARCHAR(255) NOT NULL,
    status permit_status NOT NULL DEFAULT 'pending',
    issued_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_permits_tenant UNIQUE (id, organization_id),
    CONSTRAINT fk_permits_case_tenant 
        FOREIGN KEY (case_id, organization_id) 
        REFERENCES cases(id, organization_id) 
        ON DELETE CASCADE
);
