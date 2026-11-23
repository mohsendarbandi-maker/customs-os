export type CloudflareFileManagerFolder = {
  id: string;
  parent_id: string | null;
  folder_key: string;
  folder_type: string;
  display_name: string;
  client_id: string | null;
  shipment_id: string | null;
  customs_office_id: string | null;
  is_system: boolean;
  created_at: string;
  organization_id?: string;
  relative_path?: string | null;
  file_count?: number;
};

export type CloudflareFileManagerFile = {
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
  tags: string[];
  metadata: Record<string, unknown>;
  shipment_document_id: string | null;
  customs_document_id: string | null;
  storage_path: string | null;
  operation_sections: string[];
  is_archived: boolean;
  created_at: string;
  organization_id?: string;
  relative_path?: string | null;
};

export class CloudflareFileManagerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CloudflareFileManagerError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new Error('ارتباط با سرویس فایل‌منیجر Cloudflare برقرار نشد.');
  }

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || body?.ok === false) {
    const code = typeof body?.error === 'string' ? body.error : 'FILE_MANAGER_REQUEST_FAILED';
    throw new CloudflareFileManagerError(code, response.status);
  }
  if (!body) throw new CloudflareFileManagerError('INVALID_FILE_MANAGER_RESPONSE', 502);
  return body as T;
}

export async function listCloudflareFileManagerFolders(): Promise<{ folders: CloudflareFileManagerFolder[] }> {
  return request('/api/file-manager/folders');
}

export async function listCloudflareFileManagerFiles(
  folderId: string,
  limit = 100,
  offset = 0,
): Promise<{ items: CloudflareFileManagerFile[]; total: number; limit: number; offset: number }> {
  const query = new URLSearchParams({
    folder_id: folderId,
    limit: String(limit),
    offset: String(offset),
  });
  return request('/api/file-manager/files?' + query.toString());
}

export async function searchCloudflareFileManager(
  query: string,
  limit = 50,
): Promise<{ items: Array<{
  entity_type: string;
  entity_id: string;
  title: string;
  details: string | null;
  folder_id: string | null;
  shipment_id: string | null;
  client_id: string | null;
}>; total: number; normalizedQuery?: string }> {
  const params = new URLSearchParams({ q: query, limit: String(Math.min(50, Math.max(1, limit))) });
  return request('/api/file-manager/search?' + params.toString());
}

export async function createCloudflareFileManagerFolder(input: {
  parent_id: string;
  display_name: string;
}): Promise<{ folder: CloudflareFileManagerFolder }> {
  return request('/api/file-manager/folders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
