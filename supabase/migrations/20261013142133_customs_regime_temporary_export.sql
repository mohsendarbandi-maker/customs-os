-- Add the separate temporary-export customs regime to all linked record types.
ALTER TABLE public.shipment_customs_data
  DROP CONSTRAINT IF EXISTS shipment_customs_data_customs_regime_check;
ALTER TABLE public.shipment_customs_data
  ADD CONSTRAINT shipment_customs_data_customs_regime_check
  CHECK (customs_regime IS NULL OR customs_regime IN (
    'import_definitive','export_definitive','temporary_export','import_temporary',
    'temporary_processing','external_transit','internal_transit','re_export',
    're_import','cabotage','customs_warehouse','free_zone','other'
  ));

ALTER TABLE public.customs_declarations
  DROP CONSTRAINT IF EXISTS customs_declarations_customs_regime_check;
ALTER TABLE public.customs_declarations
  ADD CONSTRAINT customs_declarations_customs_regime_check
  CHECK (customs_regime IS NULL OR customs_regime IN (
    'import_definitive','export_definitive','temporary_export','import_temporary',
    'temporary_processing','external_transit','internal_transit','re_export',
    're_import','cabotage','customs_warehouse','free_zone','other'
  ));

ALTER TABLE public.cases
  DROP CONSTRAINT IF EXISTS cases_customs_regime_check;
ALTER TABLE public.cases
  ADD CONSTRAINT cases_customs_regime_check
  CHECK (customs_regime IS NULL OR customs_regime IN (
    'import_definitive','export_definitive','temporary_export','import_temporary',
    'temporary_processing','external_transit','internal_transit','re_export',
    're_import','cabotage','customs_warehouse','free_zone','other'
  ));
