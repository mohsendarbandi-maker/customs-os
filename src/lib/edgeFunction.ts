import { supabase } from './supabase';

type EdgeResponse<T = any> = { data: T | null; error: null };
type EdgeInvokeOptions = { body?: Record<string, unknown> };

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

const jsonMessage = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const record = value as { error?: unknown; message?: unknown; details?: unknown };
    const primary = record.error ?? record.message ?? record.details;
    if (typeof primary === 'string' && primary.trim()) return primary.trim();
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return String(value);
};

const readResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return text; }
};

const directEndpoint = (name: string) => `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${encodeURIComponent(name)}`;
const proxyEndpoint = (name: string) => `/api/edge/${encodeURIComponent(name)}`;

async function request<T>(endpoint: string, token: string, body: Record<string, unknown>): Promise<EdgeResponse<T>> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(supabaseAnonKey ? { apikey: supabaseAnonKey } : {}),
      },
      body: JSON.stringify(body),
      credentials: endpoint.startsWith('/') ? 'same-origin' : 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await readResponse(response);
    if (!response.ok) throw new Error(jsonMessage(payload) || `${response.status} ${response.statusText}`);
    if (payload && typeof payload === 'object' && 'error' in payload) {
      const message = jsonMessage(payload);
      if (message) throw new Error(message);
    }
    return { data: payload as T, error: null };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('پاسخ سرویس بیش از ۶۰ ثانیه طول کشید.');
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function invokeEdgeFunction<T = any>(
  name: string,
  { body = {} }: EdgeInvokeOptions = {},
): Promise<EdgeResponse<T>> {
  if (!name || !/^[a-z0-9-]+$/i.test(name)) throw new Error('نام Edge Function نامعتبر است.');

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) throw new Error(`خطا در دریافت نشست کاربر: ${jsonMessage(sessionError)}`);

  const token = session?.access_token?.trim();
  if (!token) throw new Error('نشست کاربر معتبر نیست یا منقضی شده است. لطفاً دوباره وارد شوید.');

  const useProxy =
    typeof window !== 'undefined' &&
    !['localhost', '127.0.0.1'].includes(window.location.hostname);

  if (useProxy) {
    try {
      return await request<T>(proxyEndpoint(name), token, body);
    } catch (proxyError) {
      try {
        return await request<T>(directEndpoint(name), token, body);
      } catch (directError) {
        const directMessage = directError instanceof Error ? directError.message : String(directError);
        const proxyMessage = proxyError instanceof Error ? proxyError.message : String(proxyError);
        throw new Error(`اتصال به سرویس «${name}» ناموفق بود. ${directMessage || proxyMessage}`);
      }
    }
  }

  return request<T>(directEndpoint(name), token, body);
}
