-- Keep the customs-office choice historically attached to shipments and pre-declarations.
-- Offices in use must be deactivated rather than deleted.
ALTER TABLE public.shipments
  DROP CONSTRAINT IF EXISTS shipments_customs_office_id_fkey;
ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_customs_office_id_fkey
  FOREIGN KEY (customs_office_id) REFERENCES public.customs_offices(id) ON DELETE RESTRICT;

ALTER TABLE public.shipment_customs_data
  DROP CONSTRAINT IF EXISTS shipment_customs_data_customs_office_id_fkey;
ALTER TABLE public.shipment_customs_data
  ADD CONSTRAINT shipment_customs_data_customs_office_id_fkey
  FOREIGN KEY (customs_office_id) REFERENCES public.customs_offices(id) ON DELETE RESTRICT;
