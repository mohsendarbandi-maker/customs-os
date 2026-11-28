import type { ShipmentsD1Database } from './shipments-api';

type ShipmentFolderStatement = ReturnType<ShipmentsD1Database['prepare']>;

export interface ShipmentFolderContext {
  shipmentId: string;
  organizationId: string;
  now: string;
}

const ROOT_INSERT_SQL =
  "INSERT INTO file_manager_folders " +
  "(id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at,organization_id,relative_path) " +
  "SELECT ?,NULL,'owners-root','root','صاحبان کالا',NULL,NULL,NULL,1,?,?,'Customs OS Documents/صاحبان کالا' " +
  "WHERE NOT EXISTS (SELECT 1 FROM file_manager_folders WHERE organization_id=? AND parent_id IS NULL AND folder_key='owners-root')";

const ROOT_UPDATE_SQL =
  "UPDATE file_manager_folders SET display_name='صاحبان کالا',relative_path='Customs OS Documents/صاحبان کالا' " +
  "WHERE organization_id=? AND parent_id IS NULL AND folder_key='owners-root' AND folder_type='root'";

const CLIENT_INSERT_SQL =
  "WITH shipment_scope AS (" +
  "SELECT s.organization_id,COALESCE(s.client_id,c.client_id) AS client_id,cl.name AS client_name," +
  "r.id AS root_id,r.relative_path AS root_path " +
  "FROM shipments s LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id " +
  "JOIN clients cl ON cl.id=COALESCE(s.client_id,c.client_id) AND cl.organization_id=s.organization_id " +
  "JOIN file_manager_folders r ON r.organization_id=s.organization_id AND r.parent_id IS NULL AND r.folder_key='owners-root' " +
  "WHERE s.id=? AND s.organization_id=?) " +
  "INSERT INTO file_manager_folders " +
  "(id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at,organization_id,relative_path) " +
  "SELECT ?,root_id,'client:'||client_id,'client',client_name,client_id,NULL,NULL,1,?,organization_id,root_path||'/'||client_name " +
  "FROM shipment_scope WHERE NOT EXISTS (" +
  "SELECT 1 FROM file_manager_folders f WHERE f.organization_id=shipment_scope.organization_id " +
  "AND f.parent_id=shipment_scope.root_id AND f.folder_key='client:'||shipment_scope.client_id)";

const CLIENT_UPDATE_SQL =
  "WITH shipment_scope AS (" +
  "SELECT s.organization_id,COALESCE(s.client_id,c.client_id) AS client_id,cl.name AS client_name," +
  "r.id AS root_id,r.relative_path AS root_path " +
  "FROM shipments s LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id " +
  "JOIN clients cl ON cl.id=COALESCE(s.client_id,c.client_id) AND cl.organization_id=s.organization_id " +
  "JOIN file_manager_folders r ON r.organization_id=s.organization_id AND r.parent_id IS NULL AND r.folder_key='owners-root' " +
  "WHERE s.id=? AND s.organization_id=?) " +
  "UPDATE file_manager_folders SET " +
  "display_name=(SELECT client_name FROM shipment_scope),client_id=(SELECT client_id FROM shipment_scope)," +
  "relative_path=(SELECT root_path||'/'||client_name FROM shipment_scope) " +
  "WHERE organization_id=? AND folder_type='client' " +
  "AND folder_key='client:'||(SELECT client_id FROM shipment_scope) " +
  "AND parent_id=(SELECT root_id FROM shipment_scope)";

const SHIPMENT_SCOPE_CTE =
  "WITH shipment_scope AS (" +
  "SELECT s.id AS shipment_id,s.organization_id,COALESCE(s.client_id,c.client_id) AS client_id," +
  "COALESCE(s.customs_office_id,c.customs_office_id,sc.customs_office_id) AS customs_office_id," +
  "sf.id AS client_folder_id,sf.relative_path AS client_folder_path," +
  "COALESCE(NULLIF(TRIM(s.display_name),''),'محموله '||SUBSTR(s.id,1,8))||' — '||" +
  "CASE WHEN COALESCE(s.customs_office_id,c.customs_office_id,sc.customs_office_id) IS NULL " +
  "THEN 'گمرک نامشخص' ELSE COALESCE(NULLIF(TRIM(o.name),''),NULLIF(TRIM(o.code),''),'گمرک نامشخص')||" +
  "CASE WHEN NULLIF(TRIM(o.code),'') IS NOT NULL THEN ' ('||TRIM(o.code)||')' ELSE '' END END AS shipment_folder_name " +
  "FROM shipments s LEFT JOIN cases c ON c.id=s.case_id AND c.organization_id=s.organization_id " +
  "LEFT JOIN shipment_customs_data sc ON sc.shipment_id=s.id AND sc.organization_id=s.organization_id " +
  "LEFT JOIN customs_offices o ON o.id=COALESCE(s.customs_office_id,c.customs_office_id,sc.customs_office_id) " +
  "AND o.organization_id=s.organization_id " +
  "JOIN file_manager_folders sf ON sf.organization_id=s.organization_id AND sf.folder_type='client' " +
  "AND sf.client_id=COALESCE(s.client_id,c.client_id) " +
  "WHERE s.id=? AND s.organization_id=?)";

const SHIPMENT_INSERT_SQL =
  SHIPMENT_SCOPE_CTE +
  " INSERT INTO file_manager_folders " +
  "(id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at,organization_id,relative_path) " +
  "SELECT ?,client_folder_id,'shipment:'||shipment_id,'shipment',shipment_folder_name,client_id,shipment_id,customs_office_id,1,?,organization_id," +
  "client_folder_path||'/'||shipment_folder_name FROM shipment_scope WHERE NOT EXISTS (" +
  "SELECT 1 FROM file_manager_folders f WHERE f.organization_id=shipment_scope.organization_id " +
  "AND f.shipment_id=shipment_scope.shipment_id AND f.folder_type='shipment')";

const SHIPMENT_UPDATE_SQL =
  SHIPMENT_SCOPE_CTE +
  " UPDATE file_manager_folders SET parent_id=(SELECT client_folder_id FROM shipment_scope)," +
  "display_name=(SELECT shipment_folder_name FROM shipment_scope),client_id=(SELECT client_id FROM shipment_scope)," +
  "customs_office_id=(SELECT customs_office_id FROM shipment_scope)," +
  "relative_path=(SELECT client_folder_path||'/'||shipment_folder_name FROM shipment_scope) " +
  "WHERE organization_id=? AND shipment_id=? AND folder_type='shipment'";

const CHILDREN = [
  { key: 'accounting-finance', type: 'accounting_finance', label: 'حسابداری مالی' },
  { key: 'shipping-docs', type: 'shipping_docs', label: 'اسناد حمل و کشتی' },
  { key: 'purchase-docs', type: 'purchase_docs', label: 'پیش‌فاکتور و ثبت سفارش' },
  { key: 'warehouse-receipt', type: 'warehouse_receipt', label: 'قبض انبار' },
  { key: 'declaration', type: 'declaration', label: 'اسناد گمرکی و اظهارنامه' },
  { key: 'permits-inspection', type: 'permits', label: 'مجوزها' },
  { key: 'exit', type: 'exit', label: 'ترخیص و درب خروج' },
  { key: 'other', type: 'other', label: 'سایر اسناد' },
] as const;

const childInsertSql = () =>
  "INSERT INTO file_manager_folders " +
  "(id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at,organization_id,relative_path) " +
  "SELECT ?,sf.id,?,?,?,sf.client_id,sf.shipment_id,sf.customs_office_id,1,?,sf.organization_id,sf.relative_path||'/'||? " +
  "FROM file_manager_folders sf WHERE sf.organization_id=? AND sf.shipment_id=? AND sf.folder_type='shipment' " +
  "AND NOT EXISTS (SELECT 1 FROM file_manager_folders f WHERE f.organization_id=sf.organization_id " +
  "AND f.parent_id=sf.id AND f.folder_key=?)";

const childUpdateSql = () =>
  "UPDATE file_manager_folders SET display_name=?,client_id=(" +
  "SELECT sf.client_id FROM file_manager_folders sf WHERE sf.organization_id=? AND sf.shipment_id=? AND sf.folder_type='shipment' " +
  "ORDER BY sf.created_at,sf.id LIMIT 1),customs_office_id=(" +
  "SELECT sf.customs_office_id FROM file_manager_folders sf WHERE sf.organization_id=? AND sf.shipment_id=? AND sf.folder_type='shipment' " +
  "ORDER BY sf.created_at,sf.id LIMIT 1),relative_path=(" +
  "SELECT sf.relative_path||'/'||? FROM file_manager_folders sf WHERE sf.organization_id=? AND sf.shipment_id=? AND sf.folder_type='shipment' " +
  "ORDER BY sf.created_at,sf.id LIMIT 1),is_system=1 " +
  "WHERE organization_id=? AND shipment_id=? AND folder_type=? AND folder_key=? " +
  "AND parent_id=(SELECT sf.id FROM file_manager_folders sf WHERE sf.organization_id=? AND sf.shipment_id=? AND sf.folder_type='shipment' " +
  "ORDER BY sf.created_at,sf.id LIMIT 1)";

const SYNC_FILE_MANAGER_FILES_SQL =
  "UPDATE file_manager_files SET " +
  "client_id=(SELECT sf.client_id FROM file_manager_folders sf WHERE sf.organization_id=? AND sf.shipment_id=? AND sf.folder_type='shipment' ORDER BY sf.created_at,sf.id LIMIT 1)," +
  "relative_path=(SELECT f.relative_path||'/'||file_manager_files.original_name FROM file_manager_folders f " +
  "WHERE f.id=file_manager_files.folder_id AND f.organization_id=file_manager_files.organization_id) " +
  "WHERE organization_id=? AND shipment_id=?";

const SYNC_CUSTOMS_DOCUMENTS_SQL =
  "UPDATE customs_documents SET client_id=(" +
  "SELECT sf.client_id FROM file_manager_folders sf WHERE sf.organization_id=? AND sf.shipment_id=? AND sf.folder_type='shipment' ORDER BY sf.created_at,sf.id LIMIT 1)," +
  "updated_at=? WHERE organization_id=? AND shipment_id=?";

export const buildShipmentFileManagerFolderStatements = (
  db: ShipmentsD1Database,
  context: ShipmentFolderContext,
): ShipmentFolderStatement[] => {
  const { shipmentId, organizationId, now } = context;
  const statements: ShipmentFolderStatement[] = [
    db.prepare(ROOT_INSERT_SQL).bind(crypto.randomUUID(), now, organizationId, organizationId),
    db.prepare(ROOT_UPDATE_SQL).bind(organizationId),
    db.prepare(CLIENT_INSERT_SQL).bind(shipmentId, organizationId, crypto.randomUUID(), now),
    db.prepare(CLIENT_UPDATE_SQL).bind(shipmentId, organizationId, organizationId),
    db.prepare(SHIPMENT_INSERT_SQL).bind(shipmentId, organizationId, crypto.randomUUID(), now, organizationId, shipmentId),
    db.prepare(SHIPMENT_UPDATE_SQL).bind(shipmentId, organizationId, organizationId, shipmentId),
  ];

  for (const child of CHILDREN) {
    statements.push(db.prepare(childInsertSql()).bind(
      crypto.randomUUID(), child.key, child.type, child.label, now, child.label,
      organizationId, shipmentId, child.key,
    ));
    statements.push(db.prepare(childUpdateSql()).bind(
      child.label, organizationId, shipmentId, organizationId, shipmentId, child.label,
      organizationId, shipmentId, organizationId, shipmentId, child.type, child.key,
      organizationId, shipmentId,
    ));
  }

  statements.push(
    db.prepare(SYNC_FILE_MANAGER_FILES_SQL).bind(organizationId, shipmentId, organizationId, shipmentId),
    db.prepare(SYNC_CUSTOMS_DOCUMENTS_SQL).bind(organizationId, shipmentId, now, organizationId, shipmentId),
  );
  return statements;
};
