CREATE TABLE financial_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id UUID NOT NULL,
    recorded_by UUID,
    transaction_type transaction_type NOT NULL,
    category VARCHAR(100) NOT NULL,
    original_amount DECIMAL(18,4) NOT NULL CHECK (original_amount > 0),
    original_currency currency_code NOT NULL DEFAULT 'IRR',
    exchange_rate DECIMAL(12,4) NOT NULL DEFAULT 1.0 CHECK (exchange_rate > 0),
    base_amount_irr DECIMAL(18,2) NOT NULL CHECK (base_amount_irr > 0),
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_finance_tenant UNIQUE (id, organization_id),
    CONSTRAINT fk_finance_case_tenant 
        FOREIGN KEY (case_id, organization_id) 
        REFERENCES cases(id, organization_id) 
        ON DELETE RESTRICT,
    CONSTRAINT fk_finance_recorder_tenant 
        FOREIGN KEY (recorded_by, organization_id) 
        REFERENCES profiles(id, organization_id) 
        ON DELETE RESTRICT,
    CONSTRAINT chk_irr_exchange_rate CHECK (original_currency <> 'IRR' OR exchange_rate = 1.0),
    CONSTRAINT chk_base_amount_irr_calc CHECK (base_amount_irr = ROUND(original_amount * exchange_rate, 2))
);

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id UUID NOT NULL,
    uploaded_by UUID,
    doc_type doc_type NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes >= 0),
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_documents_tenant UNIQUE (id, organization_id),
    CONSTRAINT uq_documents_version UNIQUE (organization_id, case_id, doc_type, version),
    CONSTRAINT fk_documents_case_tenant 
        FOREIGN KEY (case_id, organization_id) 
        REFERENCES cases(id, organization_id) 
        ON DELETE CASCADE,
    CONSTRAINT fk_documents_uploader_tenant 
        FOREIGN KEY (uploaded_by, organization_id) 
        REFERENCES profiles(id, organization_id) 
        ON DELETE RESTRICT
);
