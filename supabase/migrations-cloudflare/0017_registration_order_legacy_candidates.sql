-- Migration 0017: read-only legacy registration-order reference candidates.
-- Normalized reference columns are maintained by triggers. Candidates are review-only:
-- no shipment is auto-linked and candidate rows never enter capacity reconciliation.

ALTER TABLE registration_orders ADD COLUMN order_number_normalized TEXT;
ALTER TABLE shipment_customs_data ADD COLUMN registration_order_no_normalized TEXT;
ALTER TABLE cases ADD COLUMN registration_order_no_normalized TEXT;

UPDATE registration_orders SET order_number_normalized = UPPER(TRIM(COALESCE(order_number,''))) WHERE 1=1;
UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4') WHERE 1=1;
UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9') WHERE 1=1;
UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4') WHERE 1=1;
UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9') WHERE 1=1;
UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(order_number_normalized,' ',''),char(9),''),char(10),'') WHERE 1=1;
UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(order_number_normalized,char(13),''),char(160),''),char(8204),'') WHERE 1=1;
UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(order_number_normalized,char(8203),''),char(8205),''),char(65279),'') WHERE 1=1;
UPDATE registration_orders SET order_number_normalized = NULLIF(order_number_normalized,'') WHERE 1=1;

UPDATE shipment_customs_data SET registration_order_no_normalized = UPPER(TRIM(COALESCE(registration_order_no,''))) WHERE 1=1;
UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4') WHERE 1=1;
UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9') WHERE 1=1;
UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4') WHERE 1=1;
UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9') WHERE 1=1;
UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,' ',''),char(9),''),char(10),'') WHERE 1=1;
UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(13),''),char(160),''),char(8204),'') WHERE 1=1;
UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(8203),''),char(8205),''),char(65279),'') WHERE 1=1;
UPDATE shipment_customs_data SET registration_order_no_normalized = NULLIF(registration_order_no_normalized,'') WHERE 1=1;

UPDATE cases SET registration_order_no_normalized = UPPER(TRIM(COALESCE(registration_order_no,''))) WHERE 1=1;
UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4') WHERE 1=1;
UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9') WHERE 1=1;
UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4') WHERE 1=1;
UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9') WHERE 1=1;
UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,' ',''),char(9),''),char(10),'') WHERE 1=1;
UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(13),''),char(160),''),char(8204),'') WHERE 1=1;
UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(8203),''),char(8205),''),char(65279),'') WHERE 1=1;
UPDATE cases SET registration_order_no_normalized = NULLIF(registration_order_no_normalized,'') WHERE 1=1;

CREATE TRIGGER IF NOT EXISTS registration_orders_order_number_insert AFTER INSERT ON registration_orders

BEGIN
  UPDATE registration_orders SET order_number_normalized = UPPER(TRIM(COALESCE(NEW.order_number,''))) WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(order_number_normalized,' ',''),char(9),''),char(10),'') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(order_number_normalized,char(13),''),char(160),''),char(8204),'') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(order_number_normalized,char(8203),''),char(8205),''),char(65279),'') WHERE id=NEW.id;
UPDATE registration_orders SET order_number_normalized = NULLIF(order_number_normalized,'') WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS registration_orders_order_number_update AFTER UPDATE OF order_number ON registration_orders
BEGIN
  UPDATE registration_orders SET order_number_normalized = UPPER(TRIM(COALESCE(NEW.order_number,''))) WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(order_number_normalized,'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(order_number_normalized,' ',''),char(9),''),char(10),'') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(order_number_normalized,char(13),''),char(160),''),char(8204),'') WHERE id=NEW.id;
  UPDATE registration_orders SET order_number_normalized = REPLACE(REPLACE(REPLACE(order_number_normalized,char(8203),''),char(8205),''),char(65279),'') WHERE id=NEW.id;
UPDATE registration_orders SET order_number_normalized = NULLIF(order_number_normalized,'') WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS shipment_customs_data_registration_order_no_insert AFTER INSERT ON shipment_customs_data

BEGIN
  UPDATE shipment_customs_data SET registration_order_no_normalized = UPPER(TRIM(COALESCE(NEW.registration_order_no,''))) WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,' ',''),char(9),''),char(10),'') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(13),''),char(160),''),char(8204),'') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(8203),''),char(8205),''),char(65279),'') WHERE shipment_id=NEW.shipment_id;
UPDATE shipment_customs_data SET registration_order_no_normalized = NULLIF(registration_order_no_normalized,'') WHERE shipment_id=NEW.shipment_id;
END;

CREATE TRIGGER IF NOT EXISTS shipment_customs_data_registration_order_no_update AFTER UPDATE OF registration_order_no ON shipment_customs_data
BEGIN
  UPDATE shipment_customs_data SET registration_order_no_normalized = UPPER(TRIM(COALESCE(NEW.registration_order_no,''))) WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,' ',''),char(9),''),char(10),'') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(13),''),char(160),''),char(8204),'') WHERE shipment_id=NEW.shipment_id;
  UPDATE shipment_customs_data SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(8203),''),char(8205),''),char(65279),'') WHERE shipment_id=NEW.shipment_id;
UPDATE shipment_customs_data SET registration_order_no_normalized = NULLIF(registration_order_no_normalized,'') WHERE shipment_id=NEW.shipment_id;
END;

CREATE TRIGGER IF NOT EXISTS cases_registration_order_no_insert AFTER INSERT ON cases

BEGIN
  UPDATE cases SET registration_order_no_normalized = UPPER(TRIM(COALESCE(NEW.registration_order_no,''))) WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,' ',''),char(9),''),char(10),'') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(13),''),char(160),''),char(8204),'') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(8203),''),char(8205),''),char(65279),'') WHERE id=NEW.id;
UPDATE cases SET registration_order_no_normalized = NULLIF(registration_order_no_normalized,'') WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS cases_registration_order_no_update AFTER UPDATE OF registration_order_no ON cases
BEGIN
  UPDATE cases SET registration_order_no_normalized = UPPER(TRIM(COALESCE(NEW.registration_order_no,''))) WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(registration_order_no_normalized,'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,' ',''),char(9),''),char(10),'') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(13),''),char(160),''),char(8204),'') WHERE id=NEW.id;
  UPDATE cases SET registration_order_no_normalized = REPLACE(REPLACE(REPLACE(registration_order_no_normalized,char(8203),''),char(8205),''),char(65279),'') WHERE id=NEW.id;
UPDATE cases SET registration_order_no_normalized = NULLIF(registration_order_no_normalized,'') WHERE id=NEW.id;
END;

CREATE INDEX IF NOT EXISTS shipments_org_registration_order_client_case_idx
  ON shipments (organization_id, registration_order_id, client_id, case_id);
CREATE INDEX IF NOT EXISTS shipment_customs_data_org_registration_order_shipment_idx
  ON shipment_customs_data (organization_id, registration_order_no_normalized, shipment_id);
CREATE INDEX IF NOT EXISTS registration_orders_org_client_order_number_idx
  ON registration_orders (organization_id, client_id, order_number_normalized);
CREATE INDEX IF NOT EXISTS cases_org_registration_order_no_idx
  ON cases (organization_id, registration_order_no_normalized);

CREATE VIEW IF NOT EXISTS registration_order_legacy_match_candidates AS
WITH candidate_shipments AS (
  SELECT
    s.id AS shipment_id,
    s.organization_id,
    s.client_id AS shipment_client_id,
    s.case_id,
    s.display_name AS shipment_name,
    s.bill_of_lading_no,
    d.registration_order_no AS customs_registration_order_no,
    COALESCE(d.net_weight_kg, s.net_weight_kg) AS candidate_net_weight_kg,
    COALESCE(d.gross_weight_kg, s.gross_weight_kg) AS candidate_gross_weight_kg,
    d.invoice_amount AS candidate_invoice_amount,
    d.invoice_currency AS candidate_invoice_currency,
    d.registration_order_no_normalized AS customs_order_key,
    c.registration_order_no_normalized AS case_order_key
  FROM shipments s
  INNER JOIN shipment_customs_data d
    ON d.shipment_id = s.id AND d.organization_id = s.organization_id
  LEFT JOIN cases c
    ON c.id = s.case_id AND c.organization_id = s.organization_id
  WHERE s.registration_order_id IS NULL
    AND d.registration_order_no_normalized IS NOT NULL
),
matched AS (
  SELECT
    ro.id AS registration_order_id,
    ro.organization_id,
    ro.order_number,
    ro.client_id AS registration_order_client_id,
    ro.case_id AS registration_order_case_id,
    cs.*
  FROM candidate_shipments cs
  INNER JOIN registration_orders ro
    ON ro.organization_id = cs.organization_id
   AND ro.client_id IS cs.shipment_client_id
   AND ro.order_number_normalized = cs.customs_order_key
  WHERE (
    SELECT COUNT(*)
    FROM registration_orders ro2
    WHERE ro2.organization_id = cs.organization_id
      AND ro2.client_id IS cs.shipment_client_id
      AND ro2.order_number_normalized = cs.customs_order_key
  ) = 1
)
SELECT
  registration_order_id,
  organization_id,
  order_number,
  registration_order_client_id,
  shipment_id,
  shipment_client_id,
  shipment_name,
  bill_of_lading_no,
  customs_registration_order_no,
  candidate_net_weight_kg,
  candidate_gross_weight_kg,
  candidate_invoice_amount,
  candidate_invoice_currency,
  'shipment_customs_data.registration_order_no' AS candidate_source
FROM matched
WHERE NOT (
  registration_order_case_id IS NOT NULL
  AND case_id = registration_order_case_id
)
AND case_id IS NULL
AND case_order_key IS NULL;
