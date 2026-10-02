import { supabase } from '../../lib/supabase';
import { isPwaInstalled } from './PwaLifecycle';

const b64 = (value: string): Uint8Array =>
  Uint8Array.from(
    atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)),
    (char) => char.charCodeAt(0),
  );

const supported = (): boolean =>
  typeof window !== 'undefined' &&
  'Notification' in window &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  window.isSecureContext;

export async function pushSupport(): Promise<boolean> {
  return supported() && (!/iphone|ipad|ipod/i.test(navigator.userAgent) || isPwaInstalled());
}

export async function vapidPublicKey(): Promise<string | null> {
  const envKey = String(import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim();
  if (envKey) return envKey;
  const { data, error } = await supabase.rpc('get_reminder_vapid_public_key');
  if (error || typeof data !== 'string' || !data.trim()) return null;
  return data.trim();
}

export async function enablePush(): Promise<{ status: NotificationPermission; endpoint?: string }> {
  if (!(await pushSupport())) {
    throw new Error('اعلان در این دستگاه پشتیبانی نمی‌شود؛ در آیفون ابتدا برنامه را به صفحه اصلی اضافه کنید.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { status: permission };

  const key = await vapidPublicKey();
  if (!key) throw new Error('کلید عمومی اعلان تنظیم نشده است. ابتدا کلیدهای VAPID را ثبت کنید.');

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64(key),
    });
  }

  const toBase64Url = (name: 'p256dh' | 'auth'): string => {
    const buffer = subscription.getKey(name);
    if (!buffer) throw new Error('کلید اشتراک اعلان ناقص است.');
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  };

  const { error } = await supabase.rpc('upsert_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: toBase64Url('p256dh'),
    p_auth: toBase64Url('auth'),
    p_user_agent: navigator.userAgent,
    p_platform: /iphone|ipad|ipod/i.test(navigator.userAgent)
      ? 'ios'
      : /android/i.test(navigator.userAgent)
        ? 'android'
        : 'desktop',
  });

  if (error) throw error;
  return { status: 'granted', endpoint: subscription.endpoint };
}

export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
}

export async function testPush(): Promise<void> {
  const { error } = await supabase.functions.invoke('send-push', { body: { mode: 'test' } });
  if (error) throw error;
}

export async function listPushDevices(): Promise<Array<{
  id: string;
  endpoint: string;
  user_agent: string | null;
  platform: string | null;
  created_at: string;
  last_seen_at: string;
  last_success_at: string | null;
  is_active: boolean;
  failure_count: number;
}>> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id,endpoint,user_agent,platform,created_at,last_seen_at,last_success_at,is_active,failure_count')
    .order('last_seen_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    endpoint: string;
    user_agent: string | null;
    platform: string | null;
    created_at: string;
    last_seen_at: string;
    last_success_at: string | null;
    is_active: boolean;
    failure_count: number;
  }>;
}

export async function setNotificationPreferences(values: Record<string, unknown>): Promise<void> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('ورود به سامانه لازم است.');
  const { error } = await supabase.from('notification_preferences').upsert({ user_id: user.id, ...values });
  if (error) throw error;
}
