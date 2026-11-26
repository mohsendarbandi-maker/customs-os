-- Migration 0014: read-only legacy registration-order reference candidates.
-- These rows are review-only. They are never auto-linked and never included in capacity totals.

CREATE INDEX IF NOT EXISTS shipments_org_registration_order_client_case_idx
  ON shipments (organization_id, registration_order_id, client_id, case_id);

CREATE INDEX IF NOT EXISTS shipment_customs_data_org_registration_order_shipment_idx
  ON shipment_customs_data (organization_id, registration_order_no, shipment_id);

CREATE INDEX IF NOT EXISTS registration_orders_org_client_order_number_idx
  ON registration_orders (organization_id, client_id, order_number);

CREATE INDEX IF NOT EXISTS cases_org_registration_order_no_idx
  ON cases (organization_id, registration_order_no);

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
    NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(d.registration_order_no,''))),'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4'),'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9'),'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4'),'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9'),' ',''),char(9),''),char(10),''),char(13),''),char(160),''),char(8204),''),'') AS customs_order_key,
    NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(c.registration_order_no,''))),'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4'),'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9'),'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4'),'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9'),' ',''),char(9),''),char(10),''),char(13),''),char(160),''),char(8204),''),'') AS case_order_key
  FROM shipments s
  INNER JOIN shipment_customs_data d
    ON d.shipment_id = s.id AND d.organization_id = s.organization_id
  LEFT JOIN cases c
    ON c.id = s.case_id AND c.organization_id = s.organization_id
  WHERE s.registration_order_id IS NULL
    AND NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(d.registration_order_no,''))),'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4'),'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9'),'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4'),'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9'),' ',''),char(9),''),char(10),''),char(13),''),char(160),''),char(8204),''),'') IS NOT NULL
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
   AND NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(ro.order_number,''))),'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4'),'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9'),'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4'),'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9'),' ',''),char(9),''),char(10),''),char(13),''),char(160),''),char(8204),''),'') = cs.customs_order_key
  WHERE (
    SELECT COUNT(*)
    FROM registration_orders ro2
    WHERE ro2.organization_id = cs.organization_id
      AND ro2.client_id IS cs.shipment_client_id
      AND NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(ro2.order_number,''))),'۰','0'),'۱','1'),'۲','2'),'۳','3'),'۴','4'),'۵','5'),'۶','6'),'۷','7'),'۸','8'),'۹','9'),'٠','0'),'١','1'),'٢','2'),'٣','3'),'٤','4'),'٥','5'),'٦','6'),'٧','7'),'٨','8'),'٩','9'),' ',''),char(9),''),char(10),''),char(13),''),char(160),''),char(8204),''),'') = cs.customs_order_key
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
AND case_order_key IS NULL;
