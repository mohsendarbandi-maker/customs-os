import { supabase } from '../../lib/supabase';

type PushSubscriptionJSON = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

const uint8ArrayFromBase64 = (value: string) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const detectPlatform = () => {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/windows/.test(ua)) return 'windows';
  if (/macintosh|mac os x/.test(ua)) return 'macos';
  if (/linux/.test(ua)) return 'linux';
  return 'web';
};

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

export const chatPushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export async function enableChatPush(requestPermission = true) {
  if (!chatPushSupported()) {
    throw new Error('اعلان پوش در این مرورگر در دسترس نیست.');
  }

  const ua = navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  if (isIos && !isStandalone()) {
    throw new Error('در آیفون ابتدا «چت سازمانی» را از Safari به صفحه اصلی اضافه کنید و سپس اعلان‌ها را فعال کنید.');
  }

  let permission = Notification.permission;
  if (permission !== 'granted' && requestPermission) {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? 'اعلان‌ها برای چت مسدود شده‌اند؛ از تنظیمات مرورگر یا iPhone > Notifications فعالشان کنید.' : 'اجازه اعلان صادر نشد.');
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();

  let subscription = existing;
  if (!subscription) {
    const keyResult = await supabase.rpc('get_push_vapid_public_key');
    if (keyResult.error) throw new Error(keyResult.error.message);
    if (!keyResult.data) throw new Error('کلید اعلان سامانه تنظیم نشده است.');

    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: uint8ArrayFromBase64(String(keyResult.data)),
    });
  }

  const json = subscription.toJSON() as PushSubscriptionJSON;
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('اطلاعات دستگاه برای اعلان کامل نیست.');
  }

  const result = await supabase.rpc('upsert_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent.slice(0, 500),
    p_platform: detectPlatform(),
  });
  if (result.error) throw new Error(result.error.message);

  return { subscription, platform: detectPlatform() };
}

export async function hasChatPushSubscription() {
  if (!chatPushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  return Boolean(await registration.pushManager.getSubscription());
}

export const chatPushStandalone = isStandalone;
