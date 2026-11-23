-- Customs OS File Manager search index.
-- Uses D1's SQLite FTS5 module. The index is derived and can be rebuilt
-- without changing the authoritative File Manager records.

CREATE VIRTUAL TABLE IF NOT EXISTS customs_os_file_manager_search USING fts5(
  organization_id UNINDEXED,
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  folder_id UNINDEXED,
  shipment_id UNINDEXED,
  client_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);

-- Idempotent derived-index rebuild; no source records are modified.
DELETE FROM customs_os_file_manager_search;

INSERT INTO customs_os_file_manager_search (
  organization_id, entity_type, entity_id, folder_id, shipment_id, client_id, title, body
)
SELECT f.organization_id, 'folder', f.id, f.id, f.shipment_id, f.client_id,
  COALESCE(f.display_name, ''), trim(COALESCE(f.display_name, '') || ' ' || COALESCE(f.folder_key, '') || ' ' || COALESCE(f.folder_type, '') || ' ' || COALESCE(f.relative_path, '') || ' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(f.display_name, '') || ' ' || COALESCE(f.folder_key, '') || ' ' || COALESCE(f.folder_type, '') || ' ' || COALESCE(f.relative_path, ''), '۰', '0'), '۱', '1'), '۲', '2'), '۳', '3'), '۴', '4'), '۵', '5'), '۶', '6'), '۷', '7'), '۸', '8'), '۹', '9'), '٠', '0'), '١', '1'), '٢', '2'), '٣', '3'), '٤', '4'), '٥', '5'), '٦', '6'), '٧', '7'), '٨', '8'), '٩', '9'), 'ي', 'ی'), 'ك', 'ک'))
FROM file_manager_folders AS f
WHERE f.organization_id IS NOT NULL;

INSERT INTO customs_os_file_manager_search (
  organization_id, entity_type, entity_id, folder_id, shipment_id, client_id, title, body
)
SELECT f.organization_id, 'file', f.id, f.folder_id, f.shipment_id, f.client_id,
  COALESCE(f.original_name, ''), trim(COALESCE(f.original_name, '') || ' ' || COALESCE(f.document_type, '') || ' ' || COALESCE(f.tags, '') || ' ' || COALESCE(f.relative_path, '') || ' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(f.original_name, '') || ' ' || COALESCE(f.document_type, '') || ' ' || COALESCE(f.tags, '') || ' ' || COALESCE(f.relative_path, ''), '۰', '0'), '۱', '1'), '۲', '2'), '۳', '3'), '۴', '4'), '۵', '5'), '۶', '6'), '۷', '7'), '۸', '8'), '۹', '9'), '٠', '0'), '١', '1'), '٢', '2'), '٣', '3'), '٤', '4'), '٥', '5'), '٦', '6'), '٧', '7'), '٨', '8'), '٩', '9'), 'ي', 'ی'), 'ك', 'ک'))
FROM file_manager_files AS f
WHERE f.organization_id IS NOT NULL
  AND COALESCE(f.is_archived, 0) = 0;

CREATE TRIGGER IF NOT EXISTS customs_os_file_manager_search_folder_ai
AFTER INSERT ON file_manager_folders
BEGIN
  INSERT INTO customs_os_file_manager_search (
    organization_id, entity_type, entity_id, folder_id, shipment_id, client_id, title, body
  ) VALUES (
    NEW.organization_id, 'folder', NEW.id, NEW.id, NEW.shipment_id, NEW.client_id,
    COALESCE(NEW.display_name, ''), trim(COALESCE(NEW.display_name, '') || ' ' || COALESCE(NEW.folder_key, '') || ' ' || COALESCE(NEW.folder_type, '') || ' ' || COALESCE(NEW.relative_path, '') || ' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(NEW.display_name, '') || ' ' || COALESCE(NEW.folder_key, '') || ' ' || COALESCE(NEW.folder_type, '') || ' ' || COALESCE(NEW.relative_path, ''), '۰', '0'), '۱', '1'), '۲', '2'), '۳', '3'), '۴', '4'), '۵', '5'), '۶', '6'), '۷', '7'), '۸', '8'), '۹', '9'), '٠', '0'), '١', '1'), '٢', '2'), '٣', '3'), '٤', '4'), '٥', '5'), '٦', '6'), '٧', '7'), '٨', '8'), '٩', '9'), 'ي', 'ی'), 'ك', 'ک'))
  );
END;

CREATE TRIGGER IF NOT EXISTS customs_os_file_manager_search_folder_au
AFTER UPDATE ON file_manager_folders
BEGIN
  DELETE FROM customs_os_file_manager_search
  WHERE organization_id = OLD.organization_id AND entity_type = 'folder' AND entity_id = OLD.id;

  INSERT INTO customs_os_file_manager_search (
    organization_id, entity_type, entity_id, folder_id, shipment_id, client_id, title, body
  ) VALUES (
    NEW.organization_id, 'folder', NEW.id, NEW.id, NEW.shipment_id, NEW.client_id,
    COALESCE(NEW.display_name, ''), trim(COALESCE(NEW.display_name, '') || ' ' || COALESCE(NEW.folder_key, '') || ' ' || COALESCE(NEW.folder_type, '') || ' ' || COALESCE(NEW.relative_path, '') || ' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(NEW.display_name, '') || ' ' || COALESCE(NEW.folder_key, '') || ' ' || COALESCE(NEW.folder_type, '') || ' ' || COALESCE(NEW.relative_path, ''), '۰', '0'), '۱', '1'), '۲', '2'), '۳', '3'), '۴', '4'), '۵', '5'), '۶', '6'), '۷', '7'), '۸', '8'), '۹', '9'), '٠', '0'), '١', '1'), '٢', '2'), '٣', '3'), '٤', '4'), '٥', '5'), '٦', '6'), '٧', '7'), '٨', '8'), '٩', '9'), 'ي', 'ی'), 'ك', 'ک'))
  );
END;

CREATE TRIGGER IF NOT EXISTS customs_os_file_manager_search_folder_ad
AFTER DELETE ON file_manager_folders
BEGIN
  DELETE FROM customs_os_file_manager_search
  WHERE organization_id = OLD.organization_id AND entity_type = 'folder' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS customs_os_file_manager_search_file_ai
AFTER INSERT ON file_manager_files
WHEN COALESCE(NEW.is_archived, 0) = 0
BEGIN
  INSERT INTO customs_os_file_manager_search (
    organization_id, entity_type, entity_id, folder_id, shipment_id, client_id, title, body
  ) VALUES (
    NEW.organization_id, 'file', NEW.id, NEW.folder_id, NEW.shipment_id, NEW.client_id,
    COALESCE(NEW.original_name, ''), trim(COALESCE(NEW.original_name, '') || ' ' || COALESCE(NEW.document_type, '') || ' ' || COALESCE(NEW.tags, '') || ' ' || COALESCE(NEW.relative_path, '') || ' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(NEW.original_name, '') || ' ' || COALESCE(NEW.document_type, '') || ' ' || COALESCE(NEW.tags, '') || ' ' || COALESCE(NEW.relative_path, ''), '۰', '0'), '۱', '1'), '۲', '2'), '۳', '3'), '۴', '4'), '۵', '5'), '۶', '6'), '۷', '7'), '۸', '8'), '۹', '9'), '٠', '0'), '١', '1'), '٢', '2'), '٣', '3'), '٤', '4'), '٥', '5'), '٦', '6'), '٧', '7'), '٨', '8'), '٩', '9'), 'ي', 'ی'), 'ك', 'ک'))
  );
END;

CREATE TRIGGER IF NOT EXISTS customs_os_file_manager_search_file_au
AFTER UPDATE ON file_manager_files
BEGIN
  DELETE FROM customs_os_file_manager_search
  WHERE organization_id = OLD.organization_id AND entity_type = 'file' AND entity_id = OLD.id;

  INSERT INTO customs_os_file_manager_search (
    organization_id, entity_type, entity_id, folder_id, shipment_id, client_id, title, body
  )
  SELECT NEW.organization_id, 'file', NEW.id, NEW.folder_id, NEW.shipment_id, NEW.client_id,
    COALESCE(NEW.original_name, ''), trim(COALESCE(NEW.original_name, '') || ' ' || COALESCE(NEW.document_type, '') || ' ' || COALESCE(NEW.tags, '') || ' ' || COALESCE(NEW.relative_path, '') || ' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(NEW.original_name, '') || ' ' || COALESCE(NEW.document_type, '') || ' ' || COALESCE(NEW.tags, '') || ' ' || COALESCE(NEW.relative_path, ''), '۰', '0'), '۱', '1'), '۲', '2'), '۳', '3'), '۴', '4'), '۵', '5'), '۶', '6'), '۷', '7'), '۸', '8'), '۹', '9'), '٠', '0'), '١', '1'), '٢', '2'), '٣', '3'), '٤', '4'), '٥', '5'), '٦', '6'), '٧', '7'), '٨', '8'), '٩', '9'), 'ي', 'ی'), 'ك', 'ک'))
  WHERE COALESCE(NEW.is_archived, 0) = 0;
END;

CREATE TRIGGER IF NOT EXISTS customs_os_file_manager_search_file_ad
AFTER DELETE ON file_manager_files
BEGIN
  DELETE FROM customs_os_file_manager_search
  WHERE organization_id = OLD.organization_id AND entity_type = 'file' AND entity_id = OLD.id;
END;
