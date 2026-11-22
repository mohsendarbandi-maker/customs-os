-- Customs OS Cloudflare migration staging control schema.
-- NOT the operational Customs OS schema. Contains no production data.
-- Apply to the isolated staging D1 database only.

CREATE TABLE IF NOT EXISTS _migration_manifest (
  id TEXT PRIMARY KEY CHECK (id = 'customs-os'),
  source_repo TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('staging','schema_ready','data_import','validated','cutover')),
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS _migration_table_state (
  source_schema TEXT NOT NULL,
  source_table TEXT NOT NULL,
  target_database TEXT NOT NULL,
  migration_strategy TEXT NOT NULL CHECK (migration_strategy IN ('direct','transform','archive_r2','manual_review','excluded')),
  status TEXT NOT NULL CHECK (status IN ('not_started','exported','importing','imported','verified','blocked')),
  source_row_count INTEGER,
  imported_row_count INTEGER NOT NULL DEFAULT 0,
  source_estimated_bytes INTEGER,
  imported_estimated_bytes INTEGER,
  source_checksum_sha256 TEXT,
  imported_checksum_sha256 TEXT,
  resume_cursor TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (source_schema, source_table)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS _migration_chunk_checkpoint (
  source_schema TEXT NOT NULL,
  source_table TEXT NOT NULL,
  chunk_number INTEGER NOT NULL,
  first_source_id TEXT,
  last_source_id TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('exported','imported','verified','failed')),
  completed_at TEXT,
  PRIMARY KEY (source_schema, source_table, chunk_number),
  FOREIGN KEY (source_schema, source_table)
    REFERENCES _migration_table_state(source_schema, source_table)
    ON DELETE RESTRICT
) WITHOUT ROWID;

INSERT OR IGNORE INTO _migration_manifest
  (id, source_repo, source_commit, stage, schema_version)
VALUES
  ('customs-os', 'mohsendarbandi-maker/customs-os',
   '5cba78a125366320ec7ab831b317992dd3f80cb3', 'staging', 1);
