-- Migration 0007: integer-safe registration-order capacity enforcement.
-- Every weight and value operand is rounded individually to the nearest 0.001 unit,
-- cast to INTEGER, and only then aggregated and compared. This prevents binary
-- floating-point summation from changing a capacity decision.
-- Values with precision finer than 0.001 are rejected at the database boundary.
-- The original 0006 triggers are replaced atomically by versioned D1 migration.

DROP TRIGGER IF EXISTS registration_order_external_allocation_before_insert;
DROP TRIGGER IF EXISTS registration_order_external_allocation_before_update;
DROP TRIGGER IF EXISTS registration_order_master_before_insert;
DROP TRIGGER IF EXISTS registration_order_master_before_update;
DROP TRIGGER IF EXISTS registration_order_closed_update_guard;

CREATE TRIGGER registration_order_external_allocation_before_insert
BEFORE INSERT ON registration_order_external_allocations
BEGIN
  SELECT CASE WHEN NEW.net_weight_kg <> ROUND(NEW.net_weight_kg,3)
    OR (NEW.gross_weight_kg IS NOT NULL AND NEW.gross_weight_kg <> ROUND(NEW.gross_weight_kg,3))
    OR NEW.value_amount <> ROUND(NEW.value_amount,3)
    THEN RAISE(ABORT, 'REGISTRATION_ORDER_PRECISION_INVALID') END;

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
      SELECT SUM(CAST(ROUND(COALESCE(d.net_weight_kg,s.net_weight_kg,0) * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(a.net_weight_kg * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled'
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE CAST(ROUND(NEW.net_weight_kg * 1000) AS INTEGER) END
  ) > (
    SELECT CAST(ROUND(ro.net_weight_kg * 1000) AS INTEGER) FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_NET_CAPACITY_EXCEEDED') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(CAST(ROUND(COALESCE(d.gross_weight_kg,s.gross_weight_kg,0) * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(COALESCE(a.gross_weight_kg,0) * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled'
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE CAST(ROUND(COALESCE(NEW.gross_weight_kg,0) * 1000) AS INTEGER) END
  ) > (
    SELECT CAST(ROUND(ro.gross_weight_kg * 1000) AS INTEGER) FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_GROSS_CAPACITY_EXCEEDED') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(CAST(ROUND(d.invoice_amount * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(a.value_amount * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled'
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE CAST(ROUND(NEW.value_amount * 1000) AS INTEGER) END
  ) > (
    SELECT CAST(ROUND(ro.value_amount * 1000) AS INTEGER) FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_VALUE_CAPACITY_EXCEEDED') END;
END;

CREATE TRIGGER registration_order_external_allocation_before_update
BEFORE UPDATE ON registration_order_external_allocations
BEGIN
  SELECT CASE WHEN NEW.net_weight_kg <> ROUND(NEW.net_weight_kg,3)
    OR (NEW.gross_weight_kg IS NOT NULL AND NEW.gross_weight_kg <> ROUND(NEW.gross_weight_kg,3))
    OR NEW.value_amount <> ROUND(NEW.value_amount,3)
    THEN RAISE(ABORT, 'REGISTRATION_ORDER_PRECISION_INVALID') END;

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
      SELECT SUM(CAST(ROUND(COALESCE(d.net_weight_kg,s.net_weight_kg,0) * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(a.net_weight_kg * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled' AND a.id <> OLD.id
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE CAST(ROUND(NEW.net_weight_kg * 1000) AS INTEGER) END
  ) > (
    SELECT CAST(ROUND(ro.net_weight_kg * 1000) AS INTEGER) FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_NET_CAPACITY_EXCEEDED') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(CAST(ROUND(COALESCE(d.gross_weight_kg,s.gross_weight_kg,0) * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(COALESCE(a.gross_weight_kg,0) * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled' AND a.id <> OLD.id
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE CAST(ROUND(COALESCE(NEW.gross_weight_kg,0) * 1000) AS INTEGER) END
  ) > (
    SELECT CAST(ROUND(ro.gross_weight_kg * 1000) AS INTEGER) FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_GROSS_CAPACITY_EXCEEDED') END;

  SELECT CASE WHEN (
    COALESCE((
      SELECT SUM(CAST(ROUND(d.invoice_amount * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(a.value_amount * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id = NEW.organization_id
        AND a.registration_order_id = NEW.registration_order_id
        AND a.status <> 'cancelled' AND a.id <> OLD.id
    ),0)
    + CASE WHEN NEW.status = 'cancelled' THEN 0 ELSE CAST(ROUND(NEW.value_amount * 1000) AS INTEGER) END
  ) > (
    SELECT CAST(ROUND(ro.value_amount * 1000) AS INTEGER) FROM registration_orders ro
    WHERE ro.id = NEW.registration_order_id AND ro.organization_id = NEW.organization_id
  ) THEN RAISE(ABORT, 'REGISTRATION_ORDER_VALUE_CAPACITY_EXCEEDED') END;
END;

CREATE TRIGGER registration_order_master_before_insert
BEFORE INSERT ON registration_orders
BEGIN
  SELECT CASE WHEN
    (NEW.net_weight_kg IS NOT NULL AND NEW.net_weight_kg <> ROUND(NEW.net_weight_kg,3))
    OR (NEW.gross_weight_kg IS NOT NULL AND NEW.gross_weight_kg <> ROUND(NEW.gross_weight_kg,3))
    OR (NEW.value_amount IS NOT NULL AND NEW.value_amount <> ROUND(NEW.value_amount,3))
    THEN RAISE(ABORT, 'REGISTRATION_ORDER_PRECISION_INVALID') END;
END;

CREATE TRIGGER registration_order_closed_update_guard
BEFORE UPDATE ON registration_orders
WHEN OLD.is_closed = 1
BEGIN
  SELECT RAISE(ABORT, 'REGISTRATION_ORDER_CLOSED');
END;

CREATE TRIGGER registration_order_master_before_update
BEFORE UPDATE OF client_id, net_weight_kg, gross_weight_kg, value_amount, currency, is_closed
ON registration_orders
BEGIN
  SELECT CASE WHEN OLD.is_closed = 1
    THEN RAISE(ABORT, 'REGISTRATION_ORDER_CLOSED') END;
  SELECT CASE WHEN
    (NEW.net_weight_kg IS NOT NULL AND NEW.net_weight_kg <> ROUND(NEW.net_weight_kg,3))
    OR (NEW.gross_weight_kg IS NOT NULL AND NEW.gross_weight_kg <> ROUND(NEW.gross_weight_kg,3))
    OR (NEW.value_amount IS NOT NULL AND NEW.value_amount <> ROUND(NEW.value_amount,3))
    THEN RAISE(ABORT, 'REGISTRATION_ORDER_PRECISION_INVALID') END;

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
      SELECT SUM(CAST(ROUND(COALESCE(d.net_weight_kg,s.net_weight_kg,0) * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(a.net_weight_kg * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  > 0) THEN RAISE(ABORT, 'ORDER_NET_CAPACITY_CANNOT_BE_CLEARED') END;

  SELECT CASE WHEN NEW.net_weight_kg IS NOT NULL AND (
    COALESCE((
      SELECT SUM(CAST(ROUND(COALESCE(d.net_weight_kg,s.net_weight_kg,0) * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(a.net_weight_kg * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  > CAST(ROUND(NEW.net_weight_kg * 1000) AS INTEGER)) THEN RAISE(ABORT, 'ORDER_NET_WEIGHT_BELOW_ALLOCATED') END;

  SELECT CASE WHEN NEW.gross_weight_kg IS NOT NULL AND (
    COALESCE((
      SELECT SUM(CAST(ROUND(COALESCE(d.gross_weight_kg,s.gross_weight_kg,0) * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(COALESCE(a.gross_weight_kg,0) * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  > CAST(ROUND(NEW.gross_weight_kg * 1000) AS INTEGER)) THEN RAISE(ABORT, 'ORDER_GROSS_WEIGHT_BELOW_ALLOCATED') END;

  SELECT CASE WHEN NEW.value_amount IS NULL AND (
    COALESCE((
      SELECT SUM(CAST(ROUND(d.invoice_amount * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(a.value_amount * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  > 0) THEN RAISE(ABORT, 'ORDER_VALUE_CAPACITY_CANNOT_BE_CLEARED') END;

  SELECT CASE WHEN NEW.value_amount IS NOT NULL AND (
    COALESCE((
      SELECT SUM(CAST(ROUND(d.invoice_amount * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(a.value_amount * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  > CAST(ROUND(NEW.value_amount * 1000) AS INTEGER)) THEN RAISE(ABORT, 'ORDER_VALUE_BELOW_ALLOCATED') END;

  SELECT CASE WHEN NEW.is_closed=1 AND (
    NEW.net_weight_kg IS NULL OR (
      COALESCE((
        SELECT SUM(CAST(ROUND(COALESCE(d.net_weight_kg,s.net_weight_kg,0) * 1000) AS INTEGER))
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
        SELECT SUM(CAST(ROUND(a.net_weight_kg * 1000) AS INTEGER)) FROM registration_order_external_allocations a
        WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
      ),0)
    ) <> CAST(ROUND(NEW.net_weight_kg * 1000) AS INTEGER)
  ) THEN RAISE(ABORT, 'ORDER_FINALIZE_NET_WEIGHT_MISMATCH') END;
  
  SELECT CASE WHEN NEW.is_closed=1 AND NEW.gross_weight_kg IS NOT NULL AND (
    COALESCE((
      SELECT SUM(CAST(ROUND(COALESCE(d.gross_weight_kg,s.gross_weight_kg,0) * 1000) AS INTEGER))
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
      SELECT SUM(CAST(ROUND(COALESCE(a.gross_weight_kg,0) * 1000) AS INTEGER)) FROM registration_order_external_allocations a
      WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
    ),0)
  ) <> CAST(ROUND(NEW.gross_weight_kg * 1000) AS INTEGER) THEN RAISE(ABORT, 'ORDER_FINALIZE_GROSS_WEIGHT_MISMATCH') END;

  SELECT CASE WHEN NEW.is_closed=1 AND (
    NEW.value_amount IS NULL OR NEW.currency IS NULL OR
    abs((
      COALESCE((
        SELECT SUM(CAST(ROUND(d.invoice_amount * 1000) AS INTEGER))
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
        SELECT SUM(CAST(ROUND(a.value_amount * 1000) AS INTEGER)) FROM registration_order_external_allocations a
        WHERE a.organization_id=OLD.organization_id AND a.registration_order_id=OLD.id AND a.status<>'cancelled'
      ),0)
    ) - CAST(ROUND(NEW.value_amount * 1000) AS INTEGER)) > 0
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
