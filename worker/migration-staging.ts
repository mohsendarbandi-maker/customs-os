import { isMigrationIntegrityHealthy, isMigrationParityHealthy } from './migration-diagnostics';

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(sql: string): D1Statement;
}
interface StaticAssets {
  fetch(request: Request): Promise<Response>;
}
interface Env {
  MIGRATION_DB: D1Database;
  ASSETS?: StaticAssets;
  MIGRATION_ENVIRONMENT?: string;
  PRODUCTION_DATA_IMPORTED?: string;
  CUSTOMS_ADMIN_PASSWORD?: string;
  GEMINI_API_KEY?: string;
}

const COOKIE = 'customs_os_stage_session';
const ADMIN_EMAIL = 'admin@darbandicommercial.ir';
const SESSION_HOURS = 12;
const profile = {
  id: 'owner-cloudflare-staging',
  organization_id: 'ad95fdf1-e0e2-439b-92b0-c20ab07cacdd',
  role: 'owner',
  full_name: 'مدیر سامانه',
  is_active: true,
};

const json = (body: unknown, status = 200, extra: HeadersInit = {}) => {
  const headers = new Headers(extra);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store, private');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'same-origin');
  return new Response(JSON.stringify(body), { status, headers });
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
};

const createToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

const constantTimeEqual = (left: string, right: string) => {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
};

const readCookie = (request: Request) => {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return value.join('=');
  }
  return '';
};

const setCookie = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

const isSameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get('origin');
  return (!origin || origin === url.origin) &&
    request.headers.get('sec-fetch-site') !== 'cross-site';
};

const getSession = async (request: Request, env: Env) => {
  const token = readCookie(request);
  if (!token) return false;
  const tokenHash = await sha256(token);
  const row = await env.MIGRATION_DB.prepare(
    'SELECT user_id, expires_at FROM customs_admin_sessions WHERE token_hash = ? LIMIT 1',
  ).bind(tokenHash).first<{ user_id: string; expires_at: string }>();
  if (!row) return false;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await env.MIGRATION_DB.prepare(
      'DELETE FROM customs_admin_sessions WHERE token_hash = ?',
    ).bind(tokenHash).run();
    return false;
  }
  return true;
};

const handleGemini = async (request: Request, env: Env): Promise<Response> => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  const url = new URL(request.url);
  if (!isSameOrigin(request, url)) return json({ error: 'ORIGIN_FORBIDDEN' }, 403);
  if (!await getSession(request, env)) return json({ error: 'UNAUTHORIZED' }, 401);
  if (!env.GEMINI_API_KEY) return json({ error: 'AI_NOT_CONFIGURED' }, 503);
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 18 * 1024 * 1024) return json({ error: 'DOCUMENT_TOO_LARGE', limit_mb: 18 }, 413);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'INVALID_REQUEST' }, 400); }

  const query = String(body.query || '').slice(0, 12000);
  const documentText = String(body.document_text || '').slice(0, 30000);
  const mimeType = String(body.document_mime_type || '').toLowerCase();
  let documentData = String(body.document_data || '').replace(/^data:[^;]+;base64,/, '');
  const extraction = Boolean(body.extraction || body.extract || body.formFill);
  const shipExtraction = Boolean(body.shipmentExtraction || body.shipment_extraction);
  const formSchema = Array.isArray(body.formSchema) ? body.formSchema.slice(0, 100) as Array<Record<string, unknown>> : [];
  const keys = formSchema.length
    ? formSchema.map((field) => String(field.key || '')).filter(Boolean)
    : shipExtraction
      ? ['ownerName','shippingLine','vesselName','imo','count','unit','net','gross','billOfLading','billOfLadingYear','voyageNo','originPort','destinationPort']
      : extraction
        ? ['vesselType','regNumber','regDate','packageCount','warehouseReceiptNo','warehouseReceiptDate','cargoDescription','originCountry','transactionCountry','deliveryTerm','invoiceAmount','invoiceCurrency','bankBranchCode','bankName','bankBranch','lcNumber','dutyRate','tariffCode','netWeight','grossWeight','billOfLading','insuranceIrr','requiredDocuments']
        : [];
  const options = new Map(formSchema.map((field) => [String(field.key || ''), Array.isArray(field.options)
    ? field.options.map((option: unknown) => typeof option === 'object' && option !== null ? String((option as Record<string, unknown>).value || '') : String(option)).filter(Boolean)
    : []]));
  const fields = keys.map((key) => {
    const field = formSchema.find((item) => String(item.key || '') === key);
    const label = String(field?.label || key);
    const allowed = options.get(key) || [];
    return `"${key}": ${label}${allowed.length ? ` (مقادیر مجاز: ${allowed.join('، ')})` : ''}`;
  }).join('\n');
  const task = extraction
    ? `از سند ورودی فقط اطلاعات قابل مشاهده را استخراج کن. هیچ مقدار یا شناسه‌ای را حدس نزن. اعداد، تاریخ‌ها، شماره بارنامه، شماره کوتاژ، وزن خالص و ناخالص را دقیقاً حفظ کن. اگر مقدار موجود نیست رشته خالی بده. فقط یک JSON object با کلیدهای زیر و مقادیر رشته‌ای برگردان:\n${fields}`
    : `تو دستیار فارسی سامانه عملیات گمرکی هستی. دقیق، کوتاه و مبتنی بر ورودی پاسخ بده؛ هیچ شماره، تاریخ یا مقدار مالی را حدس نزن.\nپرسش: ${query || 'سند ورودی را تحلیل کن.'}`;
  const prompt = [task, documentText ? `متن سند:\n${documentText}` : '', String(body.page_context || '')].filter(Boolean).join('\n\n');
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (documentData && (mimeType === 'application/pdf' || mimeType.startsWith('image/'))) {
    if (documentData.length > 16 * 1024 * 1024) return json({ error: 'DOCUMENT_TOO_LARGE', limit_mb: 12 }, 413);
    parts.push({ inlineData: { mimeType, data: documentData } });
  } else if (documentData) {
    documentData = '';
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const generationConfig: Record<string, unknown> = { temperature: 0.1, maxOutputTokens: extraction ? 3000 : 1800 };
    if (extraction) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = {
        type: 'OBJECT',
        properties: Object.fromEntries(keys.map((key) => [key, {
          type: 'STRING',
          ...(options.get(key)?.length ? { enum: options.get(key) } : {}),
        }])),
        required: keys,
      };
    }
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let result: Record<string, unknown> = {};
    try { result = JSON.parse(raw) as Record<string, unknown>; } catch { /* handled below */ }
    if (!response.ok) {
      const detail = (result.error as Record<string, unknown> | undefined)?.message;
      const message = typeof detail === 'string' ? detail.slice(0, 500) : `Gemini HTTP ${response.status}`;
      return json({ error: response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR', message }, response.status === 429 ? 429 : 502);
    }
    const candidates = Array.isArray(result.candidates) ? result.candidates as Array<Record<string, unknown>> : [];
    const content = candidates[0]?.content as Record<string, unknown> | undefined;
    const responseParts = Array.isArray(content?.parts) ? content.parts as Array<Record<string, unknown>> : [];
    const answer = responseParts.map((part) => typeof part.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim();
    if (!answer) return json({ error: 'AI_EMPTY_RESPONSE' }, 502);
    let extracted: unknown = null;
    if (extraction) {
      try { extracted = JSON.parse(answer); }
      catch { return json({ error: 'AI_INVALID_JSON', answer: answer.slice(0, 3000) }, 502); }
    }
    return json({ answer, data: extracted, provider: 'Gemini', model: 'gemini-2.5-flash', status: 'completed', context_loaded: false });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return json({ error: aborted ? 'AI_TIMEOUT' : 'AI_REQUEST_FAILED' }, aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'customs-os-staging',
        environment: env.MIGRATION_ENVIRONMENT ?? 'staging',
        database: 'd1',
        authentication: 'cloudflare-d1-session',
        productionTraffic: false,
        productionDataImported: env.PRODUCTION_DATA_IMPORTED === 'true',
      });
    }

    if (url.pathname === '/health/db' || url.pathname.startsWith('/migration/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      }
      if (url.pathname === '/health/db') {
        try {
          const [manifest, operationalImport] = await Promise.all([
            env.MIGRATION_DB.prepare(
              "SELECT id, stage, schema_version, updated_at FROM _migration_manifest WHERE id = 'customs-os' LIMIT 1",
            ).first(),
            env.MIGRATION_DB.prepare(
              "SELECT status, expected_records, exported_at, imported_at FROM customs_os_organization_imports WHERE organization_id = ? LIMIT 1",
            ).bind(profile.organization_id).first<{ status: string; expected_records: number; exported_at: string; imported_at: string }>(),
          ]);
          return manifest
            ? json({
                ok: true,
                database: 'customs-os-migration-staging',
                manifest,
                organizationId: profile.organization_id,
                operationalDataImported: operationalImport?.status === 'imported',
                operationalImport: operationalImport ?? null,
              })
            : json({ ok: false, error: 'MIGRATION_MANIFEST_MISSING' }, 503);
        } catch {
          return json({ ok: false, error: 'STAGING_DATABASE_UNAVAILABLE' }, 503);
        }
      }
      if (url.pathname === '/migration/schema') {
        try {
          const tableList = await env.MIGRATION_DB.prepare(
            "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          ).all<{ name: string; sql: string | null }>();
          const tables: Array<{ name: string; rowCount: number | null; schemaSql: string | null; countVerified: boolean }> = [];
          let totalRows = 0;
          let countFailures = 0;

          // Identifiers originate only from sqlite_master and are safely quoted.
          // No caller-provided SQL or identifier is ever executed.
          for (const table of tableList.results) {
            const identifier = '"' + table.name.replace(/"/g, '""') + '"';
            try {
              const count = await env.MIGRATION_DB.prepare(
                'SELECT COUNT(*) AS row_count FROM ' + identifier,
              ).first<{ row_count: number }>();
              const rowCount = typeof count?.row_count === 'number' ? count.row_count : null;
              if (rowCount === null) countFailures += 1;
              else totalRows += rowCount;
              tables.push({
                name: table.name,
                rowCount,
                schemaSql: table.sql,
                countVerified: rowCount !== null,
              });
            } catch {
              countFailures += 1;
              tables.push({
                name: table.name,
                rowCount: null,
                schemaSql: table.sql,
                countVerified: false,
              });
            }
          }

          return json({
            ok: true,
            database: 'customs-os-migration-staging',
            inspection: 'read_only_sqlite_master_and_count',
            tableCount: tables.length,
            totalRows,
            countFailures,
            tables,
          });
        } catch {
          return json({ ok: false, error: 'SCHEMA_INSPECTION_UNAVAILABLE' }, 503);
        }
      }
      if (url.pathname === '/migration/parity') {
        try {
          const [importRows, tableRows] = await Promise.all([
            env.MIGRATION_DB.prepare(
              'SELECT table_name, expected_rows, imported_rows, status FROM customs_os_import_table_status WHERE organization_id = ? ORDER BY table_name',
            ).bind(profile.organization_id).all<{
              table_name: string;
              expected_rows: number;
              imported_rows: number;
              status: string;
            }>(),
            env.MIGRATION_DB.prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            ).all<{ name: string }>(),
          ]);
          const existingTables = new Set(tableRows.results.map((row) => row.name));
          const results: Array<{
            table: string;
            status: string;
            expectedRows: number;
            importedRows: number;
            actualRows: number | null;
            delta: number | null;
            verified: boolean;
          }> = [];
          let missingTargets = 0;
          let missingEmptySourceTables = 0;
          let missingRequiredTargets = 0;
          let failedCounts = 0;
          let expectedTotal = 0;
          let actualTotal = 0;
          let mismatchedTables = 0;

          for (const row of importRows.results) {
            expectedTotal += row.expected_rows;
            const tableName = row.table_name;
            if (!existingTables.has(tableName)) {
              missingTargets += 1;
              const emptySource = row.status === 'empty_in_source' &&
                row.expected_rows === 0 && row.imported_rows === 0;
              if (emptySource) missingEmptySourceTables += 1;
              else missingRequiredTargets += 1;
              results.push({
                table: tableName,
                status: row.status,
                expectedRows: row.expected_rows,
                importedRows: row.imported_rows,
                actualRows: emptySource ? 0 : null,
                delta: emptySource ? 0 : null,
                verified: emptySource,
              });
              continue;
            }
            const identifier = '"' + tableName.replace(/"/g, '""') + '"';
            try {
              const result = await env.MIGRATION_DB.prepare(
                'SELECT COUNT(*) AS row_count FROM ' + identifier,
              ).first<{ row_count: number }>();
              const actualRows = typeof result?.row_count === 'number' ? result.row_count : null;
              const delta = actualRows === null ? null : actualRows - row.expected_rows;
              if (actualRows === null) failedCounts += 1;
              else {
                actualTotal += actualRows;
                if (delta !== 0) mismatchedTables += 1;
              }
              results.push({
                table: tableName,
                status: row.status,
                expectedRows: row.expected_rows,
                importedRows: row.imported_rows,
                actualRows,
                delta,
                verified: actualRows !== null,
              });
            } catch {
              failedCounts += 1;
              results.push({
                table: tableName,
                status: row.status,
                expectedRows: row.expected_rows,
                importedRows: row.imported_rows,
                actualRows: null,
                delta: null,
                verified: false,
              });
            }
          }

          const rowCountParity = isMigrationParityHealthy({
            missingRequiredTargets,
            failedCounts,
            mismatchedTables,
          });
          return json({
            ok: rowCountParity,
            database: 'customs-os-migration-staging',
            inspection: 'read_only_import_manifest_vs_d1_counts',
            sourceTableCount: results.length,
            expectedTotal,
            actualTotal,
            missingTargets,
            missingEmptySourceTables,
            missingRequiredTargets,
            failedCounts,
            mismatchedTables,
            rowCountParity,
            tables: results,
          });
        } catch {
          return json({ ok: false, error: 'MIGRATION_PARITY_UNAVAILABLE' }, 503);
        }
      }
      if (url.pathname === '/migration/files') {
        try {
          const [fileManager, customsDocuments, shipmentDocuments] = await Promise.all([
            env.MIGRATION_DB.prepare(
              'SELECT COUNT(*) AS total, ' +
              'SUM(CASE WHEN external_message_id IS NOT NULL AND external_message_id <> \'\' THEN 1 ELSE 0 END) AS with_external_message_id, ' +
              'SUM(CASE WHEN file_asset_id IS NOT NULL AND file_asset_id <> \'\' THEN 1 ELSE 0 END) AS with_file_asset_id, ' +
              'SUM(CASE WHEN storage_path IS NOT NULL AND storage_path <> \'\' THEN 1 ELSE 0 END) AS with_storage_path, ' +
              'SUM(CASE WHEN size_bytes > 0 THEN 1 ELSE 0 END) AS with_positive_size, ' +
              'SUM(CASE WHEN mime_type IS NOT NULL AND mime_type <> \'\' THEN 1 ELSE 0 END) AS with_mime_type ' +
              'FROM file_manager_files',
            ).first<Record<string, number>>(),
            env.MIGRATION_DB.prepare(
              'SELECT COUNT(*) AS total, ' +
              'SUM(CASE WHEN telegram_message_id IS NOT NULL AND telegram_message_id <> \'\' THEN 1 ELSE 0 END) AS with_telegram_message_id, ' +
              'SUM(CASE WHEN file_asset_id IS NOT NULL AND file_asset_id <> \'\' THEN 1 ELSE 0 END) AS with_file_asset_id, ' +
              'SUM(CASE WHEN storage_path IS NOT NULL AND storage_path <> \'\' THEN 1 ELSE 0 END) AS with_storage_path, ' +
              'SUM(CASE WHEN size_bytes > 0 THEN 1 ELSE 0 END) AS with_positive_size, ' +
              'SUM(CASE WHEN mime_type IS NOT NULL AND mime_type <> \'\' THEN 1 ELSE 0 END) AS with_mime_type ' +
              'FROM customs_documents',
            ).first<Record<string, number>>(),
            env.MIGRATION_DB.prepare(
              'SELECT COUNT(*) AS total, ' +
              'SUM(CASE WHEN telegram_message_id IS NOT NULL AND telegram_message_id <> \'\' THEN 1 ELSE 0 END) AS with_telegram_message_id, ' +
              'SUM(CASE WHEN file_asset_id IS NOT NULL AND file_asset_id <> \'\' THEN 1 ELSE 0 END) AS with_file_asset_id, ' +
              'SUM(CASE WHEN storage_path IS NOT NULL AND storage_path <> \'\' THEN 1 ELSE 0 END) AS with_storage_path, ' +
              'SUM(CASE WHEN file_size_bytes > 0 THEN 1 ELSE 0 END) AS with_positive_size, ' +
              'SUM(CASE WHEN mime_type IS NOT NULL AND mime_type <> \'\' THEN 1 ELSE 0 END) AS with_mime_type ' +
              'FROM shipment_documents',
            ).first<Record<string, number>>(),
          ]);

          const storagePathBreakdown = await Promise.all([
            env.MIGRATION_DB.prepare(
              "SELECT CASE " +
              "WHEN lower(storage_path) LIKE 'telegram://%' THEN 'telegram' " +
              "WHEN lower(storage_path) LIKE 'supabase://%' THEN 'supabase' " +
              "WHEN lower(storage_path) LIKE 'http://%' OR lower(storage_path) LIKE 'https://%' THEN 'http' " +
              "WHEN storage_path IS NULL OR storage_path = '' THEN '(missing)' " +
              "ELSE 'other' END AS path_type, COUNT(*) AS total " +
              "FROM file_manager_files GROUP BY path_type ORDER BY path_type",
            ).all(),
            env.MIGRATION_DB.prepare(
              "SELECT CASE " +
              "WHEN lower(storage_path) LIKE 'telegram://%' THEN 'telegram' " +
              "WHEN lower(storage_path) LIKE 'supabase://%' THEN 'supabase' " +
              "WHEN lower(storage_path) LIKE 'http://%' OR lower(storage_path) LIKE 'https://%' THEN 'http' " +
              "WHEN storage_path IS NULL OR storage_path = '' THEN '(missing)' " +
              "ELSE 'other' END AS path_type, COUNT(*) AS total " +
              "FROM customs_documents GROUP BY path_type ORDER BY path_type",
            ).all(),
            env.MIGRATION_DB.prepare(
              "SELECT CASE " +
              "WHEN lower(storage_path) LIKE 'telegram://%' THEN 'telegram' " +
              "WHEN lower(storage_path) LIKE 'supabase://%' THEN 'supabase' " +
              "WHEN lower(storage_path) LIKE 'http://%' OR lower(storage_path) LIKE 'https://%' THEN 'http' " +
              "WHEN storage_path IS NULL OR storage_path = '' THEN '(missing)' " +
              "ELSE 'other' END AS path_type, COUNT(*) AS total " +
              "FROM shipment_documents GROUP BY path_type ORDER BY path_type",
            ).all(),
          ]);

          const backendCounts = await Promise.all([
            env.MIGRATION_DB.prepare(
              "SELECT COALESCE(NULLIF(storage_backend, ''), '(null)') AS backend, COUNT(*) AS total, " +
              "SUM(CASE WHEN telegram_message_id IS NOT NULL AND telegram_message_id <> '' THEN 1 ELSE 0 END) AS with_telegram_message_id, " +
              "SUM(CASE WHEN file_asset_id IS NOT NULL AND file_asset_id <> '' THEN 1 ELSE 0 END) AS with_file_asset_id " +
              "FROM customs_documents GROUP BY COALESCE(NULLIF(storage_backend, ''), '(null)') ORDER BY backend",
            ).all(),
            env.MIGRATION_DB.prepare(
              "SELECT COALESCE(NULLIF(storage_backend, ''), '(null)') AS backend, COUNT(*) AS total, " +
              "SUM(CASE WHEN telegram_message_id IS NOT NULL AND telegram_message_id <> '' THEN 1 ELSE 0 END) AS with_telegram_message_id, " +
              "SUM(CASE WHEN file_asset_id IS NOT NULL AND file_asset_id <> '' THEN 1 ELSE 0 END) AS with_file_asset_id " +
              "FROM shipment_documents GROUP BY COALESCE(NULLIF(storage_backend, ''), '(null)') ORDER BY backend",
            ).all(),
          ]);

          return json({
            ok: true,
            database: 'customs-os-migration-staging',
            inspection: 'read_only_file_metadata_counts_only',
            note: 'Metadata is not proof of binary availability. No file bytes, names, paths, message IDs or tokens are returned.',
            fileManagerFiles: fileManager ?? null,
            customsDocuments: customsDocuments ?? null,
            shipmentDocuments: shipmentDocuments ?? null,
            storageBackendBreakdown: {
              customsDocuments: backendCounts[0].results,
              shipmentDocuments: backendCounts[1].results,
            },
            storagePathBreakdown: {
              fileManagerFiles: storagePathBreakdown[0].results,
              customsDocuments: storagePathBreakdown[1].results,
              shipmentDocuments: storagePathBreakdown[2].results,
            },
            binaryVerification: 'not_performed',
          });
        } catch {
          return json({ ok: false, error: 'FILE_METADATA_INSPECTION_UNAVAILABLE' }, 503);
        }
      }
      if (url.pathname === '/migration/integrity') {
        const checks: Array<{ name: string; sql: string }> = [
          { name: 'cases.client_id -> clients.id', sql: "SELECT COUNT(*) AS n FROM cases c WHERE c.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients p WHERE p.id = c.client_id)" },
          { name: 'cases.customs_office_id -> customs_offices.id', sql: "SELECT COUNT(*) AS n FROM cases c WHERE c.customs_office_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customs_offices p WHERE p.id = c.customs_office_id)" },
          { name: 'shipments.case_id -> cases.id', sql: "SELECT COUNT(*) AS n FROM shipments c WHERE c.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cases p WHERE p.id = c.case_id)" },
          { name: 'shipments.client_id -> clients.id', sql: "SELECT COUNT(*) AS n FROM shipments c WHERE c.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients p WHERE p.id = c.client_id)" },
          { name: 'shipments.vessel_id -> vessels.id', sql: "SELECT COUNT(*) AS n FROM shipments c WHERE c.vessel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vessels p WHERE p.id = c.vessel_id)" },
          { name: 'shipments.registration_order_id -> registration_orders.id', sql: "SELECT COUNT(*) AS n FROM shipments c WHERE c.registration_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registration_orders p WHERE p.id = c.registration_order_id)" },
          { name: 'shipments.customs_office_id -> customs_offices.id', sql: "SELECT COUNT(*) AS n FROM shipments c WHERE c.customs_office_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customs_offices p WHERE p.id = c.customs_office_id)" },
          { name: 'shipment_customs_data.shipment_id -> shipments.id', sql: "SELECT COUNT(*) AS n FROM shipment_customs_data c WHERE NOT EXISTS (SELECT 1 FROM shipments p WHERE p.id = c.shipment_id)" },
          { name: 'shipment_customs_data.customs_office_id -> customs_offices.id', sql: "SELECT COUNT(*) AS n FROM shipment_customs_data c WHERE c.customs_office_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customs_offices p WHERE p.id = c.customs_office_id)" },
          { name: 'customs_declarations.case_id -> cases.id', sql: "SELECT COUNT(*) AS n FROM customs_declarations c WHERE c.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cases p WHERE p.id = c.case_id)" },
          { name: 'customs_declarations.shipment_id -> shipments.id', sql: "SELECT COUNT(*) AS n FROM customs_declarations c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments p WHERE p.id = c.shipment_id)" },
          { name: 'customs_declarations.customs_office_id -> customs_offices.id', sql: "SELECT COUNT(*) AS n FROM customs_declarations c WHERE c.customs_office_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customs_offices p WHERE p.id = c.customs_office_id)" },
          { name: 'shipment_documents.shipment_id -> shipments.id', sql: "SELECT COUNT(*) AS n FROM shipment_documents c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments p WHERE p.id = c.shipment_id)" },
          { name: 'file_manager_files.folder_id -> file_manager_folders.id', sql: "SELECT COUNT(*) AS n FROM file_manager_files c WHERE c.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM file_manager_folders p WHERE p.id = c.folder_id)" },
          { name: 'file_manager_files.shipment_id -> shipments.id', sql: "SELECT COUNT(*) AS n FROM file_manager_files c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments p WHERE p.id = c.shipment_id)" },
          { name: 'file_manager_files.client_id -> clients.id', sql: "SELECT COUNT(*) AS n FROM file_manager_files c WHERE c.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients p WHERE p.id = c.client_id)" },
          { name: 'file_manager_folders.parent_id -> file_manager_folders.id', sql: "SELECT COUNT(*) AS n FROM file_manager_folders c WHERE c.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM file_manager_folders p WHERE p.id = c.parent_id)" },
          { name: 'file_manager_folders.client_id -> clients.id', sql: "SELECT COUNT(*) AS n FROM file_manager_folders c WHERE c.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients p WHERE p.id = c.client_id)" },
          { name: 'file_manager_folders.shipment_id -> shipments.id', sql: "SELECT COUNT(*) AS n FROM file_manager_folders c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments p WHERE p.id = c.shipment_id)" },
          { name: 'file_manager_folders.customs_office_id -> customs_offices.id', sql: "SELECT COUNT(*) AS n FROM file_manager_folders c WHERE c.customs_office_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customs_offices p WHERE p.id = c.customs_office_id)" },
          { name: 'customs_documents.case_id -> cases.id', sql: "SELECT COUNT(*) AS n FROM customs_documents c WHERE c.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cases p WHERE p.id = c.case_id)" },
          { name: 'customs_documents.shipment_id -> shipments.id', sql: "SELECT COUNT(*) AS n FROM customs_documents c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments p WHERE p.id = c.shipment_id)" },
          { name: 'customs_documents.client_id -> clients.id', sql: "SELECT COUNT(*) AS n FROM customs_documents c WHERE c.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients p WHERE p.id = c.client_id)" },
          { name: 'customs_documents.folder_id -> file_manager_folders.id', sql: "SELECT COUNT(*) AS n FROM customs_documents c WHERE c.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM file_manager_folders p WHERE p.id = c.folder_id)" },
          { name: 'registration_orders.case_id -> cases.id', sql: "SELECT COUNT(*) AS n FROM registration_orders c WHERE c.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cases p WHERE p.id = c.case_id)" },
          { name: 'registration_orders.client_id -> clients.id', sql: "SELECT COUNT(*) AS n FROM registration_orders c WHERE c.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients p WHERE p.id = c.client_id)" },
          { name: 'financial_transactions.case_id -> cases.id', sql: "SELECT COUNT(*) AS n FROM financial_transactions c WHERE c.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cases p WHERE p.id = c.case_id)" },
          { name: 'finance_cost_items.shipment_id -> shipments.id', sql: "SELECT COUNT(*) AS n FROM finance_cost_items c WHERE c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipments p WHERE p.id = c.shipment_id)" },
          { name: 'finance_cost_items.case_id -> cases.id', sql: "SELECT COUNT(*) AS n FROM finance_cost_items c WHERE c.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cases p WHERE p.id = c.case_id)" },
          { name: 'finance_cost_items.client_id -> clients.id', sql: "SELECT COUNT(*) AS n FROM finance_cost_items c WHERE c.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients p WHERE p.id = c.client_id)" },
          { name: 'finance_cost_items.category_id -> finance_cost_categories.id', sql: "SELECT COUNT(*) AS n FROM finance_cost_items c WHERE c.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM finance_cost_categories p WHERE p.id = c.category_id)" },
          { name: 'customs_accounting_vouchers.case_id -> cases.id', sql: "SELECT COUNT(*) AS n FROM customs_accounting_vouchers c WHERE c.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cases p WHERE p.id = c.case_id)" },
          { name: 'customs_accounting_vouchers.client_id -> clients.id', sql: "SELECT COUNT(*) AS n FROM customs_accounting_vouchers c WHERE c.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients p WHERE p.id = c.client_id)" },
          { name: 'customs_accounting_vouchers.declaration_id -> customs_declarations.id', sql: "SELECT COUNT(*) AS n FROM customs_accounting_vouchers c WHERE c.declaration_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customs_declarations p WHERE p.id = c.declaration_id)" },
        ];

        const results: Array<{ name: string; orphanCount: number | null; verified: boolean }> = [];
        let failedChecks = 0;
        let orphanTotal = 0;
        for (const check of checks) {
          try {
            const result = await env.MIGRATION_DB.prepare(check.sql).first<{ n: number }>();
            const orphanCount = typeof result?.n === 'number' ? result.n : null;
            if (orphanCount === null) failedChecks += 1;
            else orphanTotal += orphanCount;
            results.push({ name: check.name, orphanCount, verified: orphanCount !== null });
          } catch {
            failedChecks += 1;
            results.push({ name: check.name, orphanCount: null, verified: false });
          }
        }

        let orphanCustomsOfficeReferences: Array<{ table: string; officeId: string; referenceCount: number }> = [];
        let customsOfficeReferenceQueryFailed = false;
        try {
          const officeReferences = await env.MIGRATION_DB.prepare(
            "SELECT table_name, office_id, COUNT(*) AS reference_count FROM (" +
            "SELECT 'cases' AS table_name, customs_office_id AS office_id FROM cases WHERE customs_office_id IS NOT NULL " +
            "UNION ALL SELECT 'shipments', customs_office_id FROM shipments WHERE customs_office_id IS NOT NULL " +
            "UNION ALL SELECT 'shipment_customs_data', customs_office_id FROM shipment_customs_data WHERE customs_office_id IS NOT NULL " +
            "UNION ALL SELECT 'customs_declarations', customs_office_id FROM customs_declarations WHERE customs_office_id IS NOT NULL " +
            "UNION ALL SELECT 'file_manager_folders', customs_office_id FROM file_manager_folders WHERE customs_office_id IS NOT NULL" +
            ") refs WHERE NOT EXISTS (SELECT 1 FROM customs_offices o WHERE o.id = refs.office_id) " +
            "GROUP BY table_name, office_id ORDER BY office_id, table_name",
          ).all<{ table_name: string; office_id: string; reference_count: number }>();
          orphanCustomsOfficeReferences = officeReferences.results.map((row) => ({
            table: row.table_name,
            officeId: row.office_id,
            referenceCount: row.reference_count,
          }));
        } catch {
          customsOfficeReferenceQueryFailed = true;
        }

        const customsOfficeReferenceCount = orphanCustomsOfficeReferences.length;
        const integrityHealthy = isMigrationIntegrityHealthy({
          failedChecks,
          orphanTotal,
          customsOfficeReferenceQueryFailed,
          orphanCustomsOfficeReferenceCount: customsOfficeReferenceCount,
        });
        return json({
          ok: integrityHealthy,
          database: 'customs-os-migration-staging',
          inspection: 'read_only_orphan_reference_counts',
          checks: results.length,
          failedChecks,
          orphanTotal,
          checksWithOrphans: results.filter((item) => item.orphanCount !== null && item.orphanCount > 0).length,
          orphanCustomsOfficeDistinctIds: new Set(orphanCustomsOfficeReferences.map((item) => item.officeId)).size,
          orphanCustomsOfficeReferences,
          customsOfficeReferenceQueryFailed,
          results,
        });
      }
      if (url.pathname === '/migration/status') {
        try {
          const [manifest, tableStates, archives] = await Promise.all([
            env.MIGRATION_DB.prepare(
              "SELECT id, stage, schema_version, updated_at FROM _migration_manifest WHERE id = 'customs-os' LIMIT 1",
            ).first(),
            env.MIGRATION_DB.prepare(
              'SELECT status, COUNT(*) AS table_count, SUM(expected_rows) AS expected_rows, SUM(imported_rows) AS imported_rows ' +
              'FROM customs_os_import_table_status WHERE organization_id = ? GROUP BY status ORDER BY status',
            ).bind(profile.organization_id).all<{
              status: string;
              table_count: number;
              expected_rows: number;
              imported_rows: number;
            }>(),
            env.MIGRATION_DB.prepare(
              'SELECT COUNT(*) AS function_count FROM supabase_edge_function_archive',
            ).first(),
          ]);
          const statusRows = tableStates.results;
          const migrationTotals = statusRows.reduce((totals, row) => ({
            sourceTables: totals.sourceTables + row.table_count,
            expectedRows: totals.expectedRows + row.expected_rows,
            importedRows: totals.importedRows + row.imported_rows,
            importedTables: totals.importedTables + (row.status === 'imported' ? row.table_count : 0),
            emptySourceTables: totals.emptySourceTables + (row.status === 'empty_in_source' ? row.table_count : 0),
          }), {
            sourceTables: 0,
            expectedRows: 0,
            importedRows: 0,
            importedTables: 0,
            emptySourceTables: 0,
          });
          const rowCountParity = migrationTotals.sourceTables > 0 &&
            migrationTotals.expectedRows === migrationTotals.importedRows &&
            migrationTotals.sourceTables === migrationTotals.importedTables + migrationTotals.emptySourceTables;
          const gates = {
            sourcePostgres: 'blocked_57P03',
            authoritativeSchemaExport: 'not_verified',
            operationalRows: rowCountParity ? 'row_count_parity_verified' : 'incomplete',
            authUsersAndSessions: 'not_imported',
            storageObjects: 'not_imported',
            edgeFunctions: 'source_archived_not_ported',
            productionCutover: 'blocked',
          };
          return json({
            ok: true,
            manifest,
            tableStates: statusRows,
            migrationTotals: { ...migrationTotals, rowCountParity },
            archivedFunctions: archives?.function_count ?? 0,
            gates,
          });
        } catch {
          return json({ ok: false, error: 'MIGRATION_STATUS_UNAVAILABLE' }, 503);
        }
      }
      if (url.pathname === '/migration/functions') {
        try {
          const result = await env.MIGRATION_DB.prepare(
            'SELECT slug, source_version, source_status, file_count, total_chars, deployed_sha256 FROM supabase_edge_function_archive ORDER BY slug',
          ).all();
          return json({
            ok: true,
            count: result.results.length,
            note: 'Source archive only; functions are not deployed as Cloudflare replacements.',
            functions: result.results,
          });
        } catch {
          return json({ ok: false, error: 'FUNCTION_ARCHIVE_UNAVAILABLE' }, 503);
        }
      }
      return json({ ok: false, error: 'NOT_FOUND' }, 404);
    }

    if (url.pathname === '/api/auth/login') {
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
      if (!isSameOrigin(request, url)) return json({ error: 'ORIGIN_FORBIDDEN' }, 403);
      if (!env.CUSTOMS_ADMIN_PASSWORD) return json({ error: 'AUTH_NOT_CONFIGURED' }, 503);

      const ipHash = await sha256(request.headers.get('cf-connecting-ip') || 'unknown');
      const now = Date.now();
      const previous = await env.MIGRATION_DB.prepare(
        'SELECT window_started_at, attempts FROM customs_admin_login_attempts WHERE ip_hash = ?',
      ).bind(ipHash).first<{ window_started_at: string; attempts: number }>();

      if (previous && now - Date.parse(previous.window_started_at) < 10 * 60 * 1000 && previous.attempts >= 8) {
        return json({ error: 'RATE_LIMITED' }, 429);
      }

      let body: { email?: string; password?: string };
      try {
        body = await request.json() as { email?: string; password?: string };
      } catch {
        return json({ error: 'INVALID_REQUEST' }, 400);
      }

      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';
      if (password.length > 256 || email !== ADMIN_EMAIL ||
          !constantTimeEqual(password, env.CUSTOMS_ADMIN_PASSWORD)) {
        if (!previous || now - Date.parse(previous.window_started_at) >= 10 * 60 * 1000) {
          await env.MIGRATION_DB.prepare(
            'INSERT INTO customs_admin_login_attempts (ip_hash, window_started_at, attempts) VALUES (?, ?, 1) ' +
            'ON CONFLICT(ip_hash) DO UPDATE SET window_started_at = excluded.window_started_at, attempts = 1',
          ).bind(ipHash, new Date(now).toISOString()).run();
        } else {
          await env.MIGRATION_DB.prepare(
            'UPDATE customs_admin_login_attempts SET attempts = attempts + 1 WHERE ip_hash = ?',
          ).bind(ipHash).run();
        }
        return json({ error: 'INVALID_CREDENTIALS' }, 401);
      }

      await env.MIGRATION_DB.prepare(
        'DELETE FROM customs_admin_login_attempts WHERE ip_hash = ?',
      ).bind(ipHash).run();

      const token = createToken();
      const tokenHash = await sha256(token);
      const expiresAt = new Date(now + SESSION_HOURS * 60 * 60 * 1000).toISOString();
      await env.MIGRATION_DB.prepare(
        'INSERT INTO customs_admin_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      ).bind(tokenHash, profile.id, expiresAt).run();

      return json({
        authenticated: true,
        user: { id: profile.id, email: ADMIN_EMAIL, full_name: profile.full_name },
        profile,
      }, 200, { 'set-cookie': setCookie(token, SESSION_HOURS * 60 * 60) });
    }

    if (url.pathname === '/api/auth/session') {
      if (request.method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
      if (!await getSession(request, env)) return json({ authenticated: false });
      return json({
        authenticated: true,
        user: { id: profile.id, email: ADMIN_EMAIL, full_name: profile.full_name },
        profile,
      });
    }

    if (url.pathname === '/api/auth/logout') {
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
      if (!isSameOrigin(request, url)) return json({ error: 'ORIGIN_FORBIDDEN' }, 403);
      const token = readCookie(request);
      if (token) {
        await env.MIGRATION_DB.prepare(
          'DELETE FROM customs_admin_sessions WHERE token_hash = ?',
        ).bind(await sha256(token)).run();
      }
      return json({ ok: true }, 200, { 'set-cookie': setCookie('', 0) });
    }

    if (url.pathname === '/api/ai' || url.pathname === '/functions/v1/ai-assistant') {
      return handleGemini(request, env);
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'API_NOT_FOUND' }, 404);

    // Supabase-compatible API paths are intentionally not proxied or mocked.
    // Their source schema/users are unavailable; returning JSON 503 avoids
    // accidentally serving index.html as a false successful database response.
    if (/^\/(auth|rest|storage|functions|realtime)\/v1(?:\/|$)/.test(url.pathname)) {
      return json({ error: 'BACKEND_MIGRATION_PENDING', message: 'Operational data services are being migrated.' }, 503);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    if (!env.ASSETS) return new Response('Static app assets are not bound', { status: 503 });
    return env.ASSETS.fetch(request);
  },
};
