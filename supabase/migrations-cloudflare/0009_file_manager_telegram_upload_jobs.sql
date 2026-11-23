-- Customs OS Telegram File Manager upload ledger.
-- Stores only upload state and Telegram receipt metadata; Telegram remains the binary archive.
-- Additive and repeatable. Existing file_manager_files records are not rewritten.

CREATE TABLE IF NOT EXISTS file_manager_upload_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  file_manager_file_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  shipment_id TEXT,
  client_id TEXT,
  original_name TEXT NOT NULL,
  document_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  document_type TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (
    status IN ('uploading', 'receipt_recorded', 'stored', 'failed', 'reconcile_required')
  ),
  telegram_chat_id TEXT,
  telegram_connection_id TEXT,
  telegram_file_id TEXT,
  telegram_file_unique_id TEXT,
  external_message_id TEXT,
  error_code TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS file_manager_upload_jobs_org_status_created_idx
  ON file_manager_upload_jobs (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS file_manager_upload_jobs_file_id_idx
  ON file_manager_upload_jobs (organization_id, file_manager_file_id);

CREATE INDEX IF NOT EXISTS file_manager_upload_jobs_folder_created_idx
  ON file_manager_upload_jobs (organization_id, folder_id, created_at DESC);
