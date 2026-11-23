-- Migration 0006: D1 registration-order master capacity and outside allocations.
-- Additive and tenant-scoped. Existing orders and shipments are preserved.
-- Exact D1 target is validated by the staging workflow before this file is applied.

CREATE UNIQUE INDEX IF NOT EXISTS registration_orders_id_organization_unique_idx
  ON registration_orders(id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS registration_orders_org_number_unique_idx
  ON registration_orders(organization_id, order_number)
  WHERE order_number IS NOT NULL AND trim(order_number) <> '';

CREATE INDEX IF NOT EXISTS registration_orders_org_created_idx
  ON registration_orders(organization_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS shipments_org_registration_order_idx
  ON shipments(organization_id, registration_order_id, client_id)
  WHERE registration_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS registration_order_external_allocations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  registration_order_id TEXT NOT NULL,
  recipient_company TEXT,
  destination_customs TEXT,
  allocation_reference TEXT,
  status TEXT NOT NULL DEFAULT 'allocated'
    CHECK (status IN ('allocated','dispatched','completed','cancelled')),
  net_weight_kg REAL NOT NULL CHECK (net_weight_kg > 0),
  gross_weight_kg REAL CHECK (gross_weight_kg IS NULL OR gross_weight_kg >= net_weight_kg),
  value_amount REAL NOT NULL CHECK (value_amount >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    nullif(trim(coalesce(recipient_company,'')),'') IS NOT NULL
    OR nullif(trim(coalesce(destination_customs,'')),'') IS NOT NULL
  ),
  FOREIGN KEY (registration_order_id, organization_id)
    REFERENCES registration_orders(id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS registration_order_external_allocations_order_idx
  ON registration_order_external_allocations(organization_id, registration_order_id, status, created_at DESC);

-- An allocation cannot exceed the current master-order capacity, including all
-- already-linked internal shipments and all active outside allocations.
CREATE TRIGGER IF NOT EXISTS registration_order_external_allocation_before_insert
BEFORE INSERT ON registration_order_external_allocations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_NOT_FOUND') END;

  SELECT CASE WHEN (
    SELECT coalesce(ro.is_closed,0) FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) <> 0 THEN RAISE(ABORT, 'REGISTRATION_ORDER_CLOSED') END;

  SELECT CASE WHEN (
    SELECT ro.net_weight_kg IS NULL OR ro.value_amount IS NULL OR ro.currency IS NULL
    FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) <> 0 THEN RAISE(ABORT, 'REGISTRATION_ORDER_CAPACITY_REQUIRED') END;

  SELECT CASE WHEN (
    SELECT ro.gross_weight_kg IS NOT NULL
    FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) = 1 AND NEW.gross_weight_kg IS NULL
    THEN RAISE(ABORT, 'REGISTRATION_ORDER_GROSS_WEIGHT_REQUIRED') END;

  SELECT CASE WHEN upper(NEW.currency) <> (
    SELECT upper(ro.currency) FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_ALLOCATION_CURRENCY_MISMATCH') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM shipments s
    LEFT JOIN cases c
      ON c.id = s.case_id AND c.organization_id = s.organization_id
    LEFT JOIN shipment_customs_data d
      ON d.shipment_id = s.id AND d.organization_id = s.organization_id
    WHERE s.organization_id = NEW.organization_id
      AND (
        s.registration_order_id = NEW.registration_order_id
        OR (
          s.registration_order_id IS NULL
          AND (
            s.case_id = (SELECT ro.case_id FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
            OR c.registration_order_no = (SELECT ro.order_number FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
          )
        )
      )
      AND (d.invoice_amount IS NULL OR nullif(trim(coalesce(d.invoice_currency,'')),'') IS NULL)
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_SHIPMENT_VALUE_INCOMPLETE') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM shipments s
    LEFT JOIN cases c
      ON c.id = s.case_id AND c.organization_id = s.organization_id
    JOIN shipment_customs_data d
      ON d.shipment_id = s.id AND d.organization_id = s.organization_id
    WHERE s.organization_id = NEW.organization_id
      AND (
        s.registration_order_id = NEW.registration_order_id
        OR (
          s.registration_order_id IS NULL
          AND (
            s.case_id = (SELECT ro.case_id FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
            OR c.registration_order_no = (SELECT ro.order_number FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
          )
        )
      )
      AND d.invoice_amount IS NOT NULL
      AND upper(trim(coalesce(d.invoice_currency,''))) <> (
        SELECT upper(ro.currency) FROM registration_orders ro
        WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
      )
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_SHIPMENT_CURRENCY_MISMATCH') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(COALESCE(d.net_weight_kg,s.net_weight_kg,0))
      FROM shipments s
      LEFT JOIN cases c ON c.id = s.case_id AND c.organization_id = s.organization_id
      LEFT JOIN shipment_customs_data d ON d.shipment_id = s.id AND d.organization_id = s.organization_id
      WHERE s.organization_id = NEW.organization_id
        AND (
          s.registration_order_id = NEW.registration_order_id
          OR (s.registration_order_id IS NULL AND (
            s.case_id = (SELECT ro.case_id FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
            OR c.registration_order_no = (SELECT ro.order_number FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
          ))
        )
    ),0)
    + COALESCE((
      SELECT SUM(a.net_weight_kg) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled'
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE NEW.net_weight_kg END
  ) > (
    SELECT ro.net_weight_kg + 0.001 FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_NET_CAPACITY_EXCEEDED') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(COALESCE(d.gross_weight_kg,s.gross_weight_kg,0))
      FROM shipments s
      LEFT JOIN cases c ON c.id = s.case_id AND c.organization_id = s.organization_id
      LEFT JOIN shipment_customs_data d ON d.shipment_id = s.id AND d.organization_id = s.organization_id
      WHERE s.organization_id = NEW.organization_id
        AND (
          s.registration_order_id = NEW.registration_order_id
          OR (s.registration_order_id IS NULL AND (
            s.case_id = (SELECT ro.case_id FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
            OR c.registration_order_no = (SELECT ro.order_number FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
          ))
        )
    ),0)
    + COALESCE((
      SELECT SUM(COALESCE(a.gross_weight_kg,0)) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled'
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE COALESCE(NEW.gross_weight_kg,0) END
  ) > (
    SELECT coalesce(ro.gross_weight_kg, 1e100) + 0.001 FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_GROSS_CAPACITY_EXCEEDED') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(d.invoice_amount)
      FROM shipments s
      LEFT JOIN cases c ON c.id = s.case_id AND c.organization_id = s.organization_id
      JOIN shipment_customs_data d ON d.shipment_id = s.id AND d.organization_id = s.organization_id
      WHERE s.organization_id = NEW.organization_id
        AND (
          s.registration_order_id = NEW.registration_order_id
          OR (s.registration_order_id IS NULL AND (
            s.case_id = (SELECT ro.case_id FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
            OR c.registration_order_no = (SELECT ro.order_number FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
          ))
        )
    ),0)
    + COALESCE((
      SELECT SUM(a.value_amount) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled'
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE NEW.value_amount END
  ) > (
    SELECT ro.value_amount + 0.01 FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_VALUE_CAPACITY_EXCEEDED') END;
END;

CREATE TRIGGER IF NOT EXISTS registration_order_external_allocation_before_update
BEFORE UPDATE ON registration_order_external_allocations
BEGIN
  SELECT CASE WHEN NEW.registration_order_id <> OLD.registration_order_id OR NEW.organization_id <> OLD.organization_id
    THEN RAISE(ABORT, 'REGISTRATION_ORDER_ALLOCATION_MOVE_FORBIDDEN') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_NOT_FOUND') END;

  SELECT CASE WHEN (
    SELECT coalesce(ro.is_closed,0) FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) <> 0 THEN RAISE(ABORT, 'REGISTRATION_ORDER_CLOSED') END;

  SELECT CASE WHEN (
    SELECT ro.net_weight_kg IS NULL OR ro.value_amount IS NULL OR ro.currency IS NULL
    FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) <> 0 THEN RAISE(ABORT, 'REGISTRATION_ORDER_CAPACITY_REQUIRED') END;

  SELECT CASE WHEN (
    SELECT ro.gross_weight_kg IS NOT NULL
    FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) = 1 AND NEW.status <> 'cancelled' AND NEW.gross_weight_kg IS NULL
    THEN RAISE(ABORT, 'REGISTRATION_ORDER_GROSS_WEIGHT_REQUIRED') END;

  SELECT CASE WHEN NEW.status <> 'cancelled' AND upper(NEW.currency) <> (
    SELECT upper(ro.currency) FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_ALLOCATION_CURRENCY_MISMATCH') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(COALESCE(d.net_weight_kg,s.net_weight_kg,0))
      FROM shipments s
      LEFT JOIN cases c ON c.id = s.case_id AND c.organization_id = s.organization_id
      LEFT JOIN shipment_customs_data d ON d.shipment_id = s.id AND d.organization_id = s.organization_id
      WHERE s.organization_id = NEW.organization_id
        AND (
          s.registration_order_id = NEW.registration_order_id
          OR (s.registration_order_id IS NULL AND (
            s.case_id = (SELECT ro.case_id FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
            OR c.registration_order_no = (SELECT ro.order_number FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
          ))
        )
    ),0)
    + COALESCE((
      SELECT SUM(a.net_weight_kg) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled' AND a.id <> OLD.id
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE NEW.net_weight_kg END
  ) > (
    SELECT ro.net_weight_kg + 0.001 FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_NET_CAPACITY_EXCEEDED') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(COALESCE(d.gross_weight_kg,s.gross_weight_kg,0))
      FROM shipments s
      LEFT JOIN cases c ON c.id = s.case_id AND c.organization_id = s.organization_id
      LEFT JOIN shipment_customs_data d ON d.shipment_id = s.id AND d.organization_id = s.organization_id
      WHERE s.organization_id = NEW.organization_id
        AND (
          s.registration_order_id = NEW.registration_order_id
          OR (s.registration_order_id IS NULL AND (
            s.case_id = (SELECT ro.case_id FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
            OR c.registration_order_no = (SELECT ro.order_number FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
          ))
        )
    ),0)
    + COALESCE((
      SELECT SUM(COALESCE(a.gross_weight_kg,0)) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled' AND a.id <> OLD.id
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE COALESCE(NEW.gross_weight_kg,0) END
  ) > (
    SELECT coalesce(ro.gross_weight_kg,1e100) + 0.001 FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_GROSS_CAPACITY_EXCEEDED') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(d.invoice_amount)
      FROM shipments s
      LEFT JOIN cases c ON c.id = s.case_id AND c.organization_id = s.organization_id
      JOIN shipment_customs_data d ON d.shipment_id = s.id AND d.organization_id = s.organization_id
      WHERE s.organization_id = NEW.organization_id
        AND (
          s.registration_order_id = NEW.registration_order_id
          OR (s.registration_order_id IS NULL AND (
            s.case_id = (SELECT ro.case_id FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
            OR c.registration_order_no = (SELECT ro.order_number FROM registration_orders ro WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id)
          ))
        )
    ),0)
    + COALESCE((
      SELECT SUM(a.value_amount) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled' AND a.id <> OLD.id
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE NEW.value_amount END
  ) > (
    SELECT ro.value_amount + 0.01 FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_VALUE_CAPACITY_EXCEEDED') END;
END;

CREATE TRIGGER IF NOT EXISTS registration_order_master_before_update
BEFORE UPDATE OF client_id, net_weight_kg, gross_weight_kg, value_amount, currency, is_closed
ON registration_orders
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM shipments s
    WHERE s.organization_id = OLD.organization_id
      AND (s.registration_order_id = OLD.id OR (
        s.registration_order_id IS NULL AND EXISTS (
          SELECT 1 FROM cases c
          WHERE c.id = s.case_id AND c.organization_id = s.organization_id
            AND (c.id = OLD.case_id OR c.registration_order_no = OLD.order_number)
        )
      ))
      AND s.client_id IS NOT NEW.client_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_CLIENT_CONFLICT') END;

  SELECT CASE WHEN NEW.net_weight_kg IS NULL AND (
    COALESCE((
      SELECT SUM(COALESCE(d.net_weight_kg,s.net_weight_kg,0))
      FROM shipments s
      LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
      LEFT JOIN shipment_customs_data d ON d.shipment_id=s.id AND d.organization_id=s.organization_id
      WHERE s.organization_id=OLD.organization_id
        AND (s.registration_order_id=OLD.id OR (
          s.registration_order_id IS NULL AND (
            s.case_id=OLD.case_id OR c.registration_order_no=OLD.order_number
          )
        ))
    ),0)
    + COALESCE((
      SELECT SUM(a.net_weight_kg) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  > 0) THEN RAISE(ABORT, 'ORDER_NET_CAPACITY_CANNOT_BE_CLEARED') END;

  SELECT CASE WHEN NEW.net_weight_kg IS NOT NULL AND (
    COALESCE((
      SELECT SUM(COALESCE(d.net_weight_kg,s.net_weight_kg,0))
      FROM shipments s
      LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
      LEFT JOIN shipment_customs_data d ON d.shipment_id=s.id AND d.organization_id=s.organization_id
      WHERE s.organization_id=OLD.organization_id
        AND (s.registration_order_id=OLD.id OR (
          s.registration_order_id IS NULL AND (
            s.case_id=OLD.case_id OR c.registration_order_no=OLD.order_number
          )
        ))
    ),0)
    + COALESCE((
      SELECT SUM(a.net_weight_kg) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  > NEW.net_weight_kg + 0.001) THEN RAISE(ABORT, 'ORDER_NET_WEIGHT_BELOW_ALLOCATED') END;

  SELECT CASE WHEN NEW.gross_weight_kg IS NOT NULL AND (
    COALESCE((
      SELECT SUM(COALESCE(d.gross_weight_kg,s.gross_weight_kg,0))
      FROM shipments s
      LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
      LEFT JOIN shipment_customs_data d ON d.shipment_id=s.id AND d.organization_id=s.organization_id
      WHERE s.organization_id=OLD.organization_id
        AND (s.registration_order_id=OLD.id OR (
          s.registration_order_id IS NULL AND (
            s.case_id=OLD.case_id OR c.registration_order_no=OLD.order_number
          )
        ))
    ),0)
    + COALESCE((
      SELECT SUM(COALESCE(a.gross_weight_kg,0)) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  > NEW.gross_weight_kg + 0.001) THEN RAISE(ABORT, 'ORDER_GROSS_WEIGHT_BELOW_ALLOCATED') END;

  SELECT CASE WHEN NEW.value_amount IS NULL AND (
    COALESCE((
      SELECT SUM(d.invoice_amount)
      FROM shipments s
      LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
      JOIN shipment_customs_data d ON d.shipment_id=s.id AND d.organization_id=s.organization_id
      WHERE s.organization_id=OLD.organization_id
        AND (s.registration_order_id=OLD.id OR (
          s.registration_order_id IS NULL AND (
            s.case_id=OLD.case_id OR c.registration_order_no=OLD.order_number
          )
        ))
    ),0)
    + COALESCE((
      SELECT SUM(a.value_amount) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  > 0) THEN RAISE(ABORT, 'ORDER_VALUE_CAPACITY_CANNOT_BE_CLEARED') END;

  SELECT CASE WHEN NEW.value_amount IS NOT NULL AND (
    COALESCE((
      SELECT SUM(d.invoice_amount)
      FROM shipments s
      LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
      JOIN shipment_customs_data d ON d.shipment_id=s.id AND d.organization_id=s.organization_id
      WHERE s.organization_id=OLD.organization_id
        AND (s.registration_order_id=OLD.id OR (
          s.registration_order_id IS NULL AND (
            s.case_id=OLD.case_id OR c.registration_order_no=OLD.order_number
          )
        ))
    ),0)
    + COALESCE((
      SELECT SUM(a.value_amount) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  > NEW.value_amount + 0.01) THEN RAISE(ABORT, 'ORDER_VALUE_BELOW_ALLOCATED') END;

  SELECT CASE WHEN NEW.is_closed=1 AND (
    NEW.net_weight_kg IS NULL OR (
      COALESCE((
        SELECT SUM(COALESCE(d.net_weight_kg,s.net_weight_kg,0))
        FROM shipments s
        LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
        LEFT JOIN shipment_customs_data d ON d.shipment_id=s.id AND d.organization_id=s.organization_id
        WHERE s.organization_id=OLD.organization_id
          AND (s.registration_order_id=OLD.id OR (
            s.registration_order_id IS NULL AND (
              s.case_id=OLD.case_id OR c.registration_order_no=OLD.order_number
            )
          ))
      ),0)
      + COALESCE((
        SELECT SUM(a.net_weight_kg) FROM registration_order_external_allocations a
        WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
      ),0)
    ) <> NEW.net_weight_kg
  ) THEN RAISE(ABORT, 'ORDER_FINALIZE_NET_WEIGHT_MISMATCH') END;
  
  SELECT CASE WHEN NEW.is_closed=1 AND NEW.gross_weight_kg IS NOT NULL AND (
    COALESCE((
      SELECT SUM(COALESCE(d.gross_weight_kg,s.gross_weight_kg,0))
      FROM shipments s
      LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
      LEFT JOIN shipment_customs_data d ON d.shipment_id=s.id AND d.organization_id=s.organization_id
      WHERE s.organization_id=OLD.organization_id
        AND (s.registration_order_id=OLD.id OR (
          s.registration_order_id IS NULL AND (
            s.case_id=OLD.case_id OR c.registration_order_no=OLD.order_number
          )
        ))
    ),0)
    + COALESCE((
      SELECT SUM(COALESCE(a.gross_weight_kg,0)) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  ) <> NEW.gross_weight_kg THEN RAISE(ABORT, 'ORDER_FINALIZE_GROSS_WEIGHT_MISMATCH') END;

  SELECT CASE WHEN NEW.is_closed=1 AND (
    NEW.value_amount IS NULL OR NEW.currency IS NULL OR
    abs((
      COALESCE((
        SELECT SUM(d.invoice_amount)
        FROM shipments s
        LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
        JOIN shipment_customs_data d ON d.shipment_id=s.id AND d.organization_id=s.organization_id
        WHERE s.organization_id=OLD.organization_id
          AND (s.registration_order_id=OLD.id OR (
            s.registration_order_id IS NULL AND (
              s.case_id=OLD.case_id OR c.registration_order_no=OLD.order_number
            )
          ))
      ),0)
      + COALESCE((
        SELECT SUM(a.value_amount) FROM registration_order_external_allocations a
        WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
      ),0)
    ) - NEW.value_amount) > 0.01
  ) THEN RAISE(ABORT, 'ORDER_FINALIZE_VALUE_MISMATCH') END;

  SELECT CASE WHEN NEW.is_closed=1 AND EXISTS (
    SELECT 1
    FROM shipments s
    LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
    LEFT JOIN shipment_customs_data d ON d.shipment_id=s.id AND d.organization_id=s.organization_id
    WHERE s.organization_id=OLD.organization_id
      AND (s.registration_order_id=OLD.id OR (
        s.registration_order_id IS NULL AND (
          s.case_id=OLD.case_id OR c.registration_order_no=OLD.order_number
        )
      ))
      AND (d.invoice_amount IS NULL OR nullif(trim(coalesce(d.invoice_currency,'')),'') IS NULL
        OR upper(trim(d.invoice_currency)) <> upper(NEW.currency))
  ) THEN RAISE(ABORT, 'ORDER_FINALIZE_MISSING_OR_MISMATCHED_INVOICE') END;

  SELECT CASE WHEN NEW.is_closed=1 AND EXISTS (
    SELECT 1 FROM registration_order_external_allocations a
    WHERE a.organization_id=OLD.organization_id
      AND a.registration_order_id=OLD.id
      AND a.status<>'cancelled'
      AND upper(a.currency) <> upper(NEW.currency)
  ) THEN RAISE(ABORT, 'ORDER_FINALIZE_EXTERNAL_CURRENCY_MISMATCH') END;

  SELECT CASE WHEN NEW.is_closed=1 AND
    (SELECT COUNT(*) FROM shipments s
      LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id
      WHERE s.organization_id=OLD.organization_id
        AND (s.registration_order_id=OLD.id OR (
          s.registration_order_id IS NULL AND (
            s.case_id=OLD.case_id OR c.registration_order_no=OLD.order_number
          )
        )))
    + (SELECT COUNT(*) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled') = 0
    THEN RAISE(ABORT, 'ORDER_FINALIZE_REQUIRES_ALLOCATION') END;
END;
