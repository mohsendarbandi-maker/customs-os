-- Shipping-line / vessel directory integrity and safe reassignment.
-- A vessel may move between shipping lines; historical shipments keep their own shipping_line text.
ALTER TABLE public.vessels DROP CONSTRAINT IF EXISTS vessels_shipping_line_id_fkey;
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_shipping_line_id_fkey
  FOREIGN KEY (shipping_line_id) REFERENCES public.shipping_lines(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vessels_org_name ON public.vessels(organization_id, lower(trim(name)));
CREATE INDEX IF NOT EXISTS idx_vessels_org_shipping_line ON public.vessels(organization_id, shipping_line_id, lower(name));

COMMENT ON COLUMN public.vessels.shipping_line_id IS 'Current associated shipping line. Can be reassigned when a vessel changes carrier; deleting a line sets this to NULL.';
COMMENT ON TABLE public.shipping_lines IS 'Organization-scoped shipping-line directory used by shipment registration.';
