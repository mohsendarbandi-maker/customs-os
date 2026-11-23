export interface FileManagerD1Statement {
  bind(...values: unknown[]): FileManagerD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface FileManagerD1Database {
  prepare(sql: string): FileManagerD1Statement;
  batch(statements: FileManagerD1Statement[]): Promise<unknown[]>;
}

export interface FileManagerApiProfile {
  id: string;
  organization_id: string;
  role: string;
  client_id?: string | null;
  is_active: boolean;
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  folder_key: string;
  folder_type: string;
  display_name: string;
  client_id: string | null;
  shipment_id: string | null;
  customs_office_id: string | null;
  is_system: number | boolean;
  created_at: string;
  organization_id: string;
  relative_path: string | null;
}

interface FileRow {
  id: string;
  folder_id: string;
  shipment_id: string | null;
  client_id: string | null;
  file_asset_id: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  external_message_id: string | null;
  document_type: string;
  tags: string | string[] | null;
  metadata: string | Record<string, unknown> | null;
  shipment_document_id: string | null;
  customs_document_id: string | null;
  storage_path: string | null;
  operation_sections: string | string[] | null;
  is_archived: number | boolean;
  created_at: string;
  organization_id: string;
  relative_path: string | null;
}

const BASE = '/api/file-manager';
const STAFF_ROLES = new Set(['owner', 'admin', 'broker', 'accountant', 'warehouse']);
const STRUCTURE_ROLES = new Set(['owner', 'admin', 'broker', 'accountant', 'warehouse']);
const EDIT_ROLES = new Set(['owner', 'admin', 'broker', 'accountant', 'warehouse']);
const SECTIONS = new Set(['evaluation', 'expertise', 'cashier', 'loading_permit', 'exit', 'port_charges']);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  },
});

const fail = (error: string, status: number) => json({ ok: false, error }, status);

const parseObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const parseArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : value.split(',').map(item => item.trim()).filter(Boolean);
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
};

const serializeFolder = (row: FolderRow, fileCount = 0) => ({
  ...row,
  is_system: Boolean(row.is_system),
  file_count: Number(fileCount || 0),
});

const serializeFile = (row: FileRow) => ({
  ...row,
  size_bytes: Number(row.size_bytes || 0),
  tags: parseArray(row.tags),
  metadata: parseObject(row.metadata),
  operation_sections: parseArray(row.operation_sections),
  is_archived: Boolean(row.is_archived),
});

const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
};

const canSeeFolder = (profile: FileManagerApiProfile, folder: FolderRow) =>
  profile.role !== 'client' || folder.folder_type === 'root' || folder.client_id === profile.client_id;

const canModifyStructure = (profile: FileManagerApiProfile) =>
  STRUCTURE_ROLES.has(profile.role);

const canEditFiles = (profile: FileManagerApiProfile) =>
  EDIT_ROLES.has(profile.role);

const readBody = async (request: Request): Promise<Record<string, unknown> | null> => {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 32 * 1024) return null;
  try {
    const body = await request.json() as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const cleanFolderName = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFKC').trim();
  if (!name || name.length > 120 || /[\/\\]/.test(name) || Array.from(name).some(ch => {
    const point = ch.codePointAt(0) ?? 0;
    return point < 0x20 || point === 0x7f;
  })) return null;
  return name;
};

const folderSlug = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('fa-IR')
  .replace(/\s+/g, '-')
  .replace(/[^\p{L}\p{N}_-]/gu, '')
  .replace(/-+/g, '-')
  .slice(0, 80) || 'folder';

const auditStatement = (
  request: Request,
  profile: FileManagerApiProfile,
  action: 'create' | 'update' | 'delete',
  entityType: 'file_manager_folder' | 'file_manager_file',
  entityId: string,
  before: unknown,
  after: unknown,
) => ({
  statement: profile.id,
  action,
  entityType,
  entityId,
  before,
  after,
});

const insertAudit = (
  db: FileManagerD1Database,
  request: Request,
  profile: FileManagerApiProfile,
  action: 'create' | 'update' | 'delete',
  entityType: 'file_manager_folder' | 'file_manager_file',
  entityId: string,
  before: unknown,
  after: unknown,
) => db.prepare(
  'INSERT INTO customs_os_audit_events ' +
  '(id, organization_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, request_id) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
).bind(
  crypto.randomUUID(),
  profile.organization_id,
  profile.id,
  action,
  entityType,
  entityId,
  before == null ? null : JSON.stringify(before),
  after == null ? null : JSON.stringify(after),
  request.headers.get('cf-ray') || crypto.randomUUID(),
);

const insertAuditIfChanged = (
  db: FileManagerD1Database,
  request: Request,
  profile: FileManagerApiProfile,
  action: 'update',
  entityType: 'file_manager_file',
  entityId: string,
  before: unknown,
  after: unknown,
) => db.prepare(
  'INSERT INTO customs_os_audit_events ' +
  '(id, organization_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, request_id) ' +
  'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0',
).bind(
  crypto.randomUUID(),profile.organization_id,profile.id,action,entityType,entityId,
  JSON.stringify(before),JSON.stringify(after),request.headers.get('cf-ray') || crypto.randomUUID(),
);

const folderById = (db: FileManagerD1Database, id: string, organizationId: string) =>
  db.prepare(
    'SELECT id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,' +
    'is_system,created_at,organization_id,relative_path FROM file_manager_folders ' +
    'WHERE id=? AND organization_id=? LIMIT 1',
  ).bind(id, organizationId).first<FolderRow>();

const fileById = (db: FileManagerD1Database, id: string, organizationId: string) =>
  db.prepare(
    'SELECT id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,' +
    'external_message_id,document_type,tags,metadata,shipment_document_id,customs_document_id,' +
    'storage_path,operation_sections,is_archived,created_at,organization_id,relative_path ' +
    'FROM file_manager_files WHERE id=? AND organization_id=? LIMIT 1',
  ).bind(id, organizationId).first<FileRow>();

const parseFolderPath = (pathname: string) => {
  if (!pathname.startsWith(BASE + '/folders/')) return null;
  const raw = pathname.slice((BASE + '/folders/').length);
  if (!raw || raw.includes('/')) return null;
  try {
    const id = decodeURIComponent(raw);
    return id.length <= 128 && !id.includes('/') ? id : null;
  } catch {
    return null;
  }
};

const parseFilePath = (pathname: string) => {
  if (!pathname.startsWith(BASE + '/files/')) return null;
  const raw = pathname.slice((BASE + '/files/').length);
  if (!raw || raw.includes('/')) return null;
  try {
    const id = decodeURIComponent(raw);
    return id.length <= 128 && !id.includes('/') ? id : null;
  } catch {
    return null;
  }
};

const parseFileActionPath = (pathname: string, action: 'archive' | 'restore') => {
  const prefix = BASE + '/files/';
  const suffix = '/' + action;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  const raw = pathname.slice(prefix.length, -suffix.length);
  if (!raw || raw.includes('/')) return null;
  try {
    const id = decodeURIComponent(raw);
    return id.length <= 128 && !id.includes('/') ? id : null;
  } catch {
    return null;
  }
};

const parseMoveFilePath = (pathname: string) => {
  const prefix = BASE + '/files/';
  const suffix = '/move';
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  const raw = pathname.slice(prefix.length, -suffix.length);
  if (!raw || raw.includes('/')) return null;
  try {
    const id = decodeURIComponent(raw);
    return id.length <= 128 && !id.includes('/') ? id : null;
  } catch {
    return null;
  }
};

const listFolders = async (db: FileManagerD1Database, profile: FileManagerApiProfile) => {
  const scope = profile.role === 'client' ? " AND (f.folder_type='root' OR f.client_id=?)" : '';
  const values: unknown[] = [profile.organization_id];
  if (profile.role === 'client') values.push(profile.client_id || '');
  const rows = await db.prepare(
    'SELECT f.id,f.parent_id,f.folder_key,f.folder_type,f.display_name,f.client_id,f.shipment_id,' +
    'f.customs_office_id,f.is_system,f.created_at,f.organization_id,f.relative_path,' +
    'COUNT(m.id) AS file_count ' +
    'FROM file_manager_folders f LEFT JOIN file_manager_files m ' +
    'ON m.folder_id=f.id AND m.organization_id=f.organization_id AND COALESCE(m.is_archived,0)=0 ' +
    'WHERE f.organization_id=?' + scope +
    ' GROUP BY f.id,f.parent_id,f.folder_key,f.folder_type,f.display_name,f.client_id,f.shipment_id,' +
    'f.customs_office_id,f.is_system,f.created_at,f.organization_id,f.relative_path ' +
    'ORDER BY f.parent_id,f.display_name COLLATE NOCASE,f.id',
  ).bind(...values).all<FolderRow & { file_count: number }>();
  return rows.results.map(row => serializeFolder(row, row.file_count));
};

const listFiles = async (
  db: FileManagerD1Database,
  profile: FileManagerApiProfile,
  folderId: string,
  limit: number,
  offset: number,
) => {
  const folder = await folderById(db, folderId, profile.organization_id);
  if (!folder || !canSeeFolder(profile, folder)) return null;
  const rows = await db.prepare(
    'SELECT id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,' +
    'external_message_id,document_type,tags,metadata,shipment_document_id,customs_document_id,' +
    'storage_path,operation_sections,is_archived,created_at,organization_id,relative_path ' +
    'FROM file_manager_files WHERE organization_id=? AND folder_id=? AND COALESCE(is_archived,0)=0 ' +
    'ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',
  ).bind(profile.organization_id, folderId, limit, offset).all<FileRow>();
  const total = await db.prepare(
    'SELECT COUNT(*) AS total FROM file_manager_files WHERE organization_id=? AND folder_id=? AND COALESCE(is_archived,0)=0',
  ).bind(profile.organization_id, folderId).first<{ total: number }>();
  return { items: rows.results.map(serializeFile), total: Number(total?.total || 0), limit, offset };
};

const createFolder = async (
  db: FileManagerD1Database,
  request: Request,
  profile: FileManagerApiProfile,
  body: Record<string, unknown>,
) => {
  if (!canModifyStructure(profile)) return fail('FOLDER_CREATE_FORBIDDEN', 403);
  const parentId = typeof body.parent_id === 'string' ? body.parent_id.trim() : '';
  const displayName = cleanFolderName(body.display_name);
  if (!parentId || !displayName) return fail('INVALID_FOLDER_INPUT', 400);
  const parent = await folderById(db, parentId, profile.organization_id);
  if (!parent || !canSeeFolder(profile, parent)) return fail('FOLDER_PARENT_NOT_FOUND', 404);
  if (!parent.shipment_id && !parent.client_id) return fail('FOLDER_PARENT_SCOPE_REQUIRED', 409);
  const folderKey = 'custom:' + folderSlug(displayName);
  const existing = await db.prepare(
    'SELECT id FROM file_manager_folders WHERE organization_id=? AND parent_id=? AND folder_key=? LIMIT 1',
  ).bind(profile.organization_id, parentId, folderKey).first<{ id: string }>();
  if (existing) return fail('FOLDER_ALREADY_EXISTS', 409);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO file_manager_folders ' +
    '(id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_at,organization_id,relative_path) ' +
    'VALUES (?,?,?,?,?,?,?,?,0,?,?,?)',
  ).bind(
    id,parentId,folderKey,'custom',displayName,parent.client_id,parent.shipment_id,
    parent.customs_office_id,createdAt,profile.organization_id,
    [parent.relative_path, displayName].filter(Boolean).join('/'),
  );
  const after = {
    id,parent_id:parentId,folder_key:folderKey,folder_type:'custom',display_name:displayName,
    client_id:parent.client_id,shipment_id:parent.shipment_id,customs_office_id:parent.customs_office_id,
    is_system:false,created_at:createdAt,organization_id:profile.organization_id,
  };
  await db.batch([insert, insertAudit(db,request,profile,'create','file_manager_folder',id,null,after)]);
  return json({ ok:true, folder:after });
};

const renameFolder = async (
  db: FileManagerD1Database,
  request: Request,
  profile: FileManagerApiProfile,
  id: string,
  body: Record<string, unknown>,
) => {
  if (!canModifyStructure(profile)) return fail('FOLDER_UPDATE_FORBIDDEN',403);
  const before = await folderById(db,id,profile.organization_id);
  if (!before) return fail('FOLDER_NOT_FOUND',404);
  if (before.folder_type !== 'custom' || Boolean(before.is_system)) return fail('SYSTEM_FOLDER_PROTECTED',409);
  const displayName = cleanFolderName(body.display_name);
  if (!displayName) return fail('INVALID_FOLDER_NAME',400);
  const folderKey = 'custom:' + folderSlug(displayName);
  const duplicate = await db.prepare(
    'SELECT id FROM file_manager_folders WHERE organization_id=? AND parent_id IS ? AND folder_key=? AND id<>? LIMIT 1',
  ).bind(profile.organization_id,before.parent_id,folderKey,id).first<{id:string}>();
  if (duplicate) return fail('FOLDER_ALREADY_EXISTS',409);
  const after = { ...before, display_name:displayName, folder_key:folderKey,
    relative_path:before.relative_path && before.parent_id ? before.relative_path.slice(0,Math.max(0,before.relative_path.lastIndexOf('/')+1))+displayName : before.relative_path };
  await db.batch([
    db.prepare('UPDATE file_manager_folders SET display_name=?,folder_key=?,relative_path=? WHERE id=? AND organization_id=? AND folder_type=\'custom\' AND COALESCE(is_system,0)=0')
      .bind(displayName,folderKey,after.relative_path,id,profile.organization_id),
    insertAudit(db,request,profile,'update','file_manager_folder',id,before,after),
  ]);
  return json({ok:true,folder:serializeFolder(after)});
};

const deleteEmptyFolder = async (
  db: FileManagerD1Database,
  request: Request,
  profile: FileManagerApiProfile,
  id: string,
) => {
  if (profile.role !== 'owner' && profile.role !== 'admin') return fail('FOLDER_DELETE_FORBIDDEN',403);
  const before = await folderById(db,id,profile.organization_id);
  if (!before) return fail('FOLDER_NOT_FOUND',404);
  if (before.folder_type !== 'custom' || Boolean(before.is_system)) return fail('SYSTEM_FOLDER_PROTECTED',409);
  const deletion = db.prepare(
    'DELETE FROM file_manager_folders WHERE id=? AND organization_id=? AND folder_type=\'custom\' ' +
    'AND COALESCE(is_system,0)=0 ' +
    'AND NOT EXISTS (SELECT 1 FROM file_manager_folders c WHERE c.parent_id=file_manager_folders.id AND c.organization_id=file_manager_folders.organization_id) ' +
    'AND NOT EXISTS (SELECT 1 FROM file_manager_files f WHERE f.folder_id=file_manager_folders.id AND f.organization_id=file_manager_folders.organization_id)',
  ).bind(id,profile.organization_id);
  const audit = db.prepare(
    'INSERT INTO customs_os_audit_events ' +
    '(id,organization_id,actor_user_id,action,entity_type,entity_id,before_json,after_json,request_id) ' +
    'SELECT ?,?,?,?,?,?,?,?,? WHERE changes() > 0',
  ).bind(
    crypto.randomUUID(),profile.organization_id,profile.id,'delete','file_manager_folder',id,
    JSON.stringify(before),null,request.headers.get('cf-ray')||crypto.randomUUID(),
  );
  const results = await db.batch([deletion,audit]);
  const row = results[0] as { meta?: { changes?: number } } | undefined;
  if (!row?.meta?.changes) return fail('FOLDER_NOT_EMPTY_OR_DELETE_BLOCKED',409);
  return json({ok:true,deleted:true,id});
};

const updateFileMetadata = async (
  db: FileManagerD1Database,
  request: Request,
  profile: FileManagerApiProfile,
  id: string,
  body: Record<string, unknown>,
) => {
  if (!canEditFiles(profile)) return fail('FILE_UPDATE_FORBIDDEN',403);
  const before = await fileById(db,id,profile.organization_id);
  if (!before) return fail('FILE_NOT_FOUND',404);
  const documentType = typeof body.document_type === 'string' ? body.document_type.trim() : before.document_type;
  if (!documentType || documentType.length > 80) return fail('INVALID_DOCUMENT_TYPE',400);
  const tags = body.tags === undefined ? parseArray(before.tags) :
    Array.isArray(body.tags) ? [...new Set(body.tags.map(String).map(s=>s.trim()).filter(Boolean))].slice(0,20) : null;
  const operationSections = body.operation_sections === undefined ? parseArray(before.operation_sections) :
    Array.isArray(body.operation_sections) ? [...new Set(body.operation_sections.map(String).filter(s=>SECTIONS.has(s)))].slice(0,20) : null;
  if (!tags || !operationSections) return fail('INVALID_FILE_METADATA',400);
  const metadata = parseObject(before.metadata);
  if (body.document_name !== undefined) {
    const name = cleanFolderName(body.document_name);
    if (!name) return fail('INVALID_DOCUMENT_NAME',400);
    metadata.documentName = name;
  }
  metadata.documentType = documentType;
  metadata.customsOperationSections = operationSections;
  const after = { ...serializeFile(before), document_type:documentType,tags,operation_sections:operationSections,metadata };
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      'UPDATE file_manager_files SET document_type=?,tags=?,metadata=?,operation_sections=? ' +
      'WHERE id=? AND organization_id=? AND COALESCE(is_archived,0)=0',
    ).bind(documentType,JSON.stringify(tags),JSON.stringify(metadata),JSON.stringify(operationSections),id,profile.organization_id),
    insertAudit(db,request,profile,'update','file_manager_file',id,serializeFile(before),after),
  ]);
  return json({ok:true,file:after});
};

const moveFile = async (
  db: FileManagerD1Database,
  request: Request,
  profile: FileManagerApiProfile,
  id: string,
  body: Record<string, unknown>,
) => {
  if (!canEditFiles(profile)) return fail('FILE_MOVE_FORBIDDEN',403);
  const before = await fileById(db,id,profile.organization_id);
  if (!before) return fail('FILE_NOT_FOUND',404);
  const folderId = typeof body.folder_id === 'string' ? body.folder_id.trim() : '';
  if (!folderId) return fail('INVALID_TARGET_FOLDER',400);
  const target = await folderById(db,folderId,profile.organization_id);
  if (!target || !canSeeFolder(profile,target)) return fail('TARGET_FOLDER_NOT_FOUND',404);
  if (target.client_id !== before.client_id || target.shipment_id !== before.shipment_id) {
    return fail('FILE_MANAGER_SCOPE_MISMATCH',409);
  }
  const after = { ...serializeFile(before),folder_id:folderId };
  const statements: FileManagerD1Statement[] = [
    db.prepare('UPDATE file_manager_files SET folder_id=? WHERE id=? AND organization_id=? AND COALESCE(is_archived,0)=0')
      .bind(folderId,id,profile.organization_id),
    insertAudit(db,request,profile,'update','file_manager_file',id,serializeFile(before),after),
  ];
  if (before.shipment_document_id) {
    statements.push(db.prepare('UPDATE shipment_documents SET folder_id=? WHERE id=? AND organization_id=?')
      .bind(folderId,before.shipment_document_id,profile.organization_id));
  }
  if (before.customs_document_id) {
    statements.push(db.prepare('UPDATE customs_documents SET folder_id=? WHERE id=? AND organization_id=?')
      .bind(folderId,before.customs_document_id,profile.organization_id));
  }
  try {
    await db.batch(statements);
  } catch {
    return fail('FILE_MOVE_BLOCKED_BY_RELATION',409);
  }
  return json({ok:true,file:after});
};

type FileManagerSearchHit = {
  entity_type: 'file' | 'folder';
  entity_id: string;
  title: string;
  details: string | null;
  folder_id: string | null;
  shipment_id: string | null;
  client_id: string | null;
};

const normalizeFileManagerSearch = (value: string) => value
  .normalize('NFKC')
  .replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabic = '٠١٢٣٤٥٦٧٨٩';
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    const index = arabic.indexOf(digit);
    return String(index >= 0 ? index : persian.indexOf(digit));
  })
  .replace(/ي/g, 'ی')
  .replace(/ك/g, 'ک')
  .trim()
  .slice(0, 160);

const searchFileManager = async (
  db: FileManagerD1Database,
  profile: FileManagerApiProfile,
  query: string,
  limit: number,
) => {
  const normalized = normalizeFileManagerSearch(query);
  const terms = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8);
  if (!terms.length) return { items: [] as FileManagerSearchHit[], total: 0 };
  // Every token is quoted and escaped before it is passed to FTS5. The user
  // cannot inject FTS operators, column selectors, or SQL through the query.
  const matchExpression = terms.map((term) => '"' + term.replace(/"/g, '""') + '"*').join(' AND ');
  const clientScope = profile.role === 'client' ? profile.client_id || '' : '';

  const [files, folders] = await Promise.all([
    db.prepare(
      'SELECT \'file\' AS entity_type,f.id AS entity_id,f.original_name AS title,' +
      'f.document_type AS details,f.folder_id,f.shipment_id,f.client_id,' +
      'bm25(customs_os_file_manager_search) AS rank ' +
      'FROM customs_os_file_manager_search ' +
      'JOIN file_manager_files f ON f.id=customs_os_file_manager_search.entity_id ' +
      'AND f.organization_id=customs_os_file_manager_search.organization_id ' +
      'JOIN file_manager_folders scope ON scope.id=f.folder_id AND scope.organization_id=f.organization_id ' +
      'WHERE customs_os_file_manager_search MATCH ? ' +
      'AND customs_os_file_manager_search.organization_id=? ' +
      'AND customs_os_file_manager_search.entity_type=\'file\' ' +
      'AND COALESCE(f.is_archived,0)=0 ' +
      'AND (?=\'\' OR scope.folder_type=\'root\' OR scope.client_id=?) ' +
      'ORDER BY rank LIMIT ?',
    ).bind(matchExpression,profile.organization_id,clientScope,clientScope,limit)
      .all<FileManagerSearchHit & { rank: number }>(),
    db.prepare(
      'SELECT \'folder\' AS entity_type,d.id AS entity_id,d.display_name AS title,' +
      'd.folder_type AS details,d.id AS folder_id,d.shipment_id,d.client_id,' +
      'bm25(customs_os_file_manager_search) AS rank ' +
      'FROM customs_os_file_manager_search ' +
      'JOIN file_manager_folders d ON d.id=customs_os_file_manager_search.entity_id ' +
      'AND d.organization_id=customs_os_file_manager_search.organization_id ' +
      'WHERE customs_os_file_manager_search MATCH ? ' +
      'AND customs_os_file_manager_search.organization_id=? ' +
      'AND customs_os_file_manager_search.entity_type=\'folder\' ' +
      'AND (?=\'\' OR d.folder_type=\'root\' OR d.client_id=?) ' +
      'ORDER BY rank LIMIT ?',
    ).bind(matchExpression,profile.organization_id,clientScope,clientScope,limit)
      .all<FileManagerSearchHit & { rank: number }>(),
  ]);
  const items = [...files.results, ...folders.results]
    .sort((a,b) => Number(a.rank || 0) - Number(b.rank || 0))
    .slice(0,limit)
    .map(({rank: _rank, ...hit}) => hit);
  return { items, total: items.length, normalizedQuery: normalized };
};

const archiveFile = async (
  db: FileManagerD1Database,
  request: Request,
  profile: FileManagerApiProfile,
  id: string,
) => {
  if (profile.role !== 'owner' && profile.role !== 'admin') return fail('FILE_ARCHIVE_FORBIDDEN',403);
  const before = await fileById(db,id,profile.organization_id);
  if (!before) return fail('FILE_NOT_FOUND',404);
  if (Boolean(before.is_archived)) return fail('FILE_ALREADY_ARCHIVED',409);
  const after = { ...serializeFile(before), is_archived:true };
  const results = await db.batch([
    db.prepare(
      'UPDATE file_manager_files SET is_archived=1 WHERE id=? AND organization_id=? AND COALESCE(is_archived,0)=0',
    ).bind(id,profile.organization_id),
    insertAuditIfChanged(db,request,profile,'update','file_manager_file',id,serializeFile(before),after),
  ]);
  const update = results[0] as { meta?: { changes?: number } } | undefined;
  if (!update?.meta?.changes) return fail('FILE_ARCHIVE_CONFLICT',409);
  return json({ok:true,archived:true,file:after});
};

const restoreFile = async (
  db: FileManagerD1Database,
  request: Request,
  profile: FileManagerApiProfile,
  id: string,
) => {
  if (profile.role !== 'owner' && profile.role !== 'admin') return fail('FILE_RESTORE_FORBIDDEN',403);
  const before = await fileById(db,id,profile.organization_id);
  if (!before) return fail('FILE_NOT_FOUND',404);
  if (!Boolean(before.is_archived)) return fail('FILE_NOT_ARCHIVED',409);
  const after = { ...serializeFile(before), is_archived:false };
  const results = await db.batch([
    db.prepare(
      'UPDATE file_manager_files SET is_archived=0 WHERE id=? AND organization_id=? AND COALESCE(is_archived,0)=1',
    ).bind(id,profile.organization_id),
    insertAuditIfChanged(db,request,profile,'update','file_manager_file',id,serializeFile(before),after),
  ]);
  const update = results[0] as { meta?: { changes?: number } } | undefined;
  if (!update?.meta?.changes) return fail('FILE_RESTORE_CONFLICT',409);
  return json({ok:true,restored:true,file:after});
};

export const handleFileManagerApi = async (
  request: Request,
  db: FileManagerD1Database,
  url: URL,
  profile: FileManagerApiProfile,
): Promise<Response> => {
  if (!profile.is_active || !profile.organization_id) return fail('FORBIDDEN',403);
  if (!sameOrigin(request,url)) return fail('ORIGIN_FORBIDDEN',403);
  const pathname = url.pathname;

  try {
    if (pathname === BASE + '/search' && request.method === 'GET') {
      const query = url.searchParams.get('q') || '';
      if (query.trim().length < 2) return fail('SEARCH_QUERY_TOO_SHORT',400);
      const requestedLimit = Number(url.searchParams.get('limit') || 50);
      const limit = Number.isSafeInteger(requestedLimit) ? Math.min(50,Math.max(1,requestedLimit)) : 50;
      const result = await searchFileManager(db,profile,query,limit);
      return json({ok:true,...result});
    }
    if (pathname === BASE + '/folders' && request.method === 'GET') {
      return json({ok:true,folders:await listFolders(db,profile)});
    }
    if (pathname === BASE + '/folders' && request.method === 'POST') {
      const body=await readBody(request);
      return body ? await createFolder(db,request,profile,body) : fail('INVALID_JSON_BODY',400);
    }
    if (pathname === BASE + '/files' && request.method === 'GET') {
      const folderId = url.searchParams.get('folder_id') || '';
      if (!folderId) return fail('FOLDER_REQUIRED',400);
      const limit = Math.min(200,Math.max(1,Number(url.searchParams.get('limit')||100)));
      const offset = Math.max(0,Number(url.searchParams.get('offset')||0));
      if (!Number.isSafeInteger(limit)||!Number.isSafeInteger(offset)) return fail('INVALID_PAGINATION',400);
      const result=await listFiles(db,profile,folderId,limit,offset);
      return result ? json({ok:true,...result}) : fail('FOLDER_NOT_FOUND',404);
    }

    const folderId=parseFolderPath(pathname);
    if (folderId && request.method === 'PATCH') {
      const body=await readBody(request);
      return body ? await renameFolder(db,request,profile,folderId,body) : fail('INVALID_JSON_BODY',400);
    }
    if (folderId && request.method === 'DELETE') {
      return await deleteEmptyFolder(db,request,profile,folderId);
    }
    const archiveFileId=parseFileActionPath(pathname,'archive');
    if (archiveFileId && request.method === 'POST') {
      return await archiveFile(db,request,profile,archiveFileId);
    }
    const restoreFileId=parseFileActionPath(pathname,'restore');
    if (restoreFileId && request.method === 'POST') {
      return await restoreFile(db,request,profile,restoreFileId);
    }
    const moveFileId=parseMoveFilePath(pathname);
    if (moveFileId && request.method === 'POST') {
      const body=await readBody(request);
      return body ? await moveFile(db,request,profile,moveFileId,body) : fail('INVALID_JSON_BODY',400);
    }
    const fileId=parseFilePath(pathname);
    if (fileId && request.method === 'PATCH') {
      const body=await readBody(request);
      return body ? await updateFileMetadata(db,request,profile,fileId,body) : fail('INVALID_JSON_BODY',400);
    }
    return fail('NOT_FOUND',404);
  } catch {
    return fail('FILE_MANAGER_API_NOT_READY',503);
  }
};
