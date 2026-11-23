-- Migration: 0002_customs_offices_reference_seed
-- Restore the two shared customs-office rows referenced by imported business records.
-- Source of office ID, code and name: verified file metadata in the 2026-11-23
-- organization export (including archived Telegram captions/file metadata).
-- City: Bandar Anzali, the locality for both reference offices.
-- Idempotent: INSERT OR IGNORE preserves any pre-existing record.
-- D1 Staging only. No operational foreign keys or imported business rows are modified.

INSERT OR IGNORE INTO customs_offices (
  id,
  code,
  name,
  city,
  is_active,
  created_at,
  organization_id,
  file_manager_search_text
) VALUES
(
  '3aa9da26-3ded-40e4-8772-51c5f4d8385b',
  '20100',
  'منطقه آزاد تجاری صنعتی انزلی',
  'بندر انزلی',
  1,
  '2026-11-23T00:00:00.000Z',
  NULL,
  '{"id":"3aa9da26-3ded-40e4-8772-51c5f4d8385b","code":"20100","name":"منطقه آزاد تجاری صنعتی انزلی","city":"بندر انزلی","organization_id":null}'
),
(
  'faa23eed-35f3-49e4-be70-7d880edf3f07',
  '20601',
  'منطقه آزاد گمرک حسن رود',
  'بندر انزلی',
  1,
  '2026-11-23T00:00:00.000Z',
  NULL,
  '{"id":"faa23eed-35f3-49e4-be70-7d880edf3f07","code":"20601","name":"منطقه آزاد گمرک حسن رود","city":"بندر انزلی","organization_id":null}'
);

-- Emit an observable result for diagnostics. The Worker integrity endpoint
-- remains the authoritative acceptance gate after this migration is applied.
SELECT COUNT(*) AS restored_customs_offices
FROM customs_offices
WHERE (id = '3aa9da26-3ded-40e4-8772-51c5f4d8385b'
       AND code = '20100'
       AND name = 'منطقه آزاد تجاری صنعتی انزلی'
       AND organization_id IS NULL)
   OR (id = 'faa23eed-35f3-49e4-be70-7d880edf3f07'
       AND code = '20601'
       AND name = 'منطقه آزاد گمرک حسن رود'
       AND organization_id IS NULL);
