CREATE TYPE user_role AS ENUM ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client');

CREATE TYPE case_status AS ENUM (
  'draft',
  'registration_order',
  'documents_ready',
  'epl_submitted',
  'kottaj_received',
  'path_green',
  'path_yellow',
  'path_red',
  'valuation',
  'duties_calculation',
  'exit_permit',
  'completed',
  'archived'
);

CREATE TYPE transport_mode AS ENUM ('sea', 'air', 'land', 'rail');
CREATE TYPE container_size AS ENUM ('20DV', '40DV', '40HC', '40RF', 'LCL', 'BULK');
CREATE TYPE currency_code AS ENUM ('IRR', 'USD', 'EUR', 'AED', 'CNY', 'RUB', 'GBP', 'CHF', 'TRY');
CREATE TYPE transaction_type AS ENUM ('expense', 'revenue', 'deposit', 'withdrawal');
CREATE TYPE permit_status AS ENUM ('pending', 'approved', 'rejected', 'not_required');

CREATE TYPE doc_type AS ENUM (
  'proforma_invoice',
  'commercial_invoice',
  'packing_list',
  'bill_of_lading',
  'certificate_of_origin',
  'health_certificate',
  'standard_permit',
  'insurance',
  'customs_declaration',
  'exit_permit',
  'receipt',
  'other'
);
