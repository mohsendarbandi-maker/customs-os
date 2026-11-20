-- Backfill historical declaration metadata only when its shipment/predeclaration provides
-- an organization-matched source of truth. Conflicting customs-office references are left alone.
WITH trusted_source AS (
  SELECT
    d.id AS declaration_id,
    COALESCE(s.customs_office_id, p.customs_office_id) AS source_customs_office_id,
    p.customs_regime AS source_customs_regime
  FROM public.customs_declarations d
  JOIN public.shipments s
    ON s.id = d.shipment_id
   AND s.organization_id = d.organization_id
  LEFT JOIN public.shipment_customs_data p
    ON p.shipment_id = s.id
   AND p.organization_id = s.organization_id
  WHERE
    (d.customs_office_id IS NULL AND COALESCE(s.customs_office_id, p.customs_office_id) IS NOT NULL)
    OR (d.customs_regime IS NULL AND p.customs_regime IS NOT NULL)
)
UPDATE public.customs_declarations d
SET
  customs_office_id = COALESCE(d.customs_office_id, source.source_customs_office_id),
  customs_regime = COALESCE(d.customs_regime, source.source_customs_regime),
  updated_at = now()
FROM trusted_source source
WHERE d.id = source.declaration_id
  AND NOT EXISTS (
    SELECT 1
    FROM public.shipments s
    JOIN public.shipment_customs_data p
      ON p.shipment_id = s.id
     AND p.organization_id = s.organization_id
    WHERE s.id = d.shipment_id
      AND s.organization_id = d.organization_id
      AND s.customs_office_id IS NOT NULL
      AND p.customs_office_id IS NOT NULL
      AND s.customs_office_id <> p.customs_office_id
  );
