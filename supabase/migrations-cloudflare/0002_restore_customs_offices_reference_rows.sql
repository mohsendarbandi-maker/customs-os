-- Migration: restore_customs_offices_reference_rows
-- Restore the two missing, historically referenced shared customs-office records.
-- Evidence: the 2026-11-23 organization export contains these exact office IDs,
-- names and customsOfficeCode values in multiple File Manager file metadata rows.
-- The city value is normalized to Bandar Anzali (Gilan) for both office locations.
-- This is additive and preserves every referenced UUID; no operational row is changed.

CREATE UNIQUE INDEX IF NOT EXISTS customs_offices_code_unique_idx
  ON customs_offices(code);

INSERT INTO customs_offices (
  id,
  code,
  name,
  city,
  is_active,
  created_at,
  organization_id,
  file_manager_search_text
) VALUES (
  '3aa9da26-3ded-40e4-8772-51c5f4d8385b',
  '20100',
  'منطقه آزاد تجاری صنعتی انزلی',
  'بندر انزلی',
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL,
  '{"id":"3aa9da26-3ded-40e4-8772-51c5f4d8385b","code":"20100","name":"منطقه آزاد تجاری صنعتی انزلی","city":"بندر انزلی"}'
)
ON CONFLICT(id) DO UPDATE SET
  code = excluded.code,
  name = excluded.name,
  city = excluded.city,
  is_active = excluded.is_active,
  organization_id = NULL,
  file_manager_search_text = excluded.file_manager_search_text;

INSERT INTO customs_offices (
  id,
  code,
  name,
  city,
  is_active,
  created_at,
  organization_id,
  file_manager_search_text
) VALUES (
  'faa23eed-35f3-49e4-be70-7d880edf3f07',
  '20601',
  'منطقه آزاد گمرک حسن رود',
  'بندر انزلی',
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL,
  '{"id":"faa23eed-35f3-49e4-be70-7d880edf3f07","code":"20601","name":"منطقه آزاد گمرک حسن رود","city":"بندر انزلی"}'
)
ON CONFLICT(id) DO UPDATE SET
  code = excluded.code,
  name = excluded.name,
  city = excluded.city,
  is_active = excluded.is_active,
  organization_id = NULL,
  file_manager_search_text = excluded.file_manager_search_text;
