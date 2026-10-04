import {supabase} from '../../lib/supabase';
import {invokeEdgeFunction} from '../../lib/edgeFunction';
import {isPwaInstalled} from './PwaLifecycle';

const b64=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const supported=()=>typeof window!=='undefined'&&'Notification' in window&&'serviceWorker' in navigator&&'PushManager' in window&&window.isSecureContext;
export async function pushSupport(){return supported()&&(!/iphone|ipad|ipod/i.test(navigator.userAgent)||isPwaInstalled());}
export async function vapidPublicKey(){
 const env=String(import.meta.env.VITE_VAPID_PUBLIC_KEY??'').trim(); if(env)return env;
 const {data,error}=await supabase.rpc('get_reminder_vapid_public_key');
 if(error||typeof data!=='string'||!data)return null;
 return data;
}
async function bootstrap(){const {data,error}=await invokeEdgeFunction<{publicKey:string}>('send-reminders',{body:{mode:'bootstrap'}});if(error)throw error;return data as {publicKey:string};}
export async function enablePush(){
 if(!(await pushSupport()))throw new Error('اعلان در این دستگاه پشتیبانی نمی‌شود؛ در آیفون باید برنامه را به صفحه اصلی اضافه کنید.');
 const permission=await Notification.requestPermission(); if(permission!=='granted')return {status:permission as NotificationPermission};
 let key=await vapidPublicKey(); if(!key){const boot=await bootstrap();key=boot.publicKey;}
 const reg=await navigator.serviceWorker.ready;
 let sub=await reg.pushManager.getSubscription();
 if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(key)});
 const json={endpoint:sub.endpoint,keys:{p256dh:sub.getKey('p256dh')?btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')!))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''): '',auth:sub.getKey('auth')?btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')!))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):''}};
 const {error}=await supabase.rpc('upsert_push_subscription',{p_endpoint:json.endpoint,p_p256dh:json.keys.p256dh,p_auth:json.keys.auth,p_user_agent:navigator.userAgent,p_platform:/iphone|ipad|ipod/i.test(navigator.userAgent)?'ios':/android/i.test(navigator.userAgent)?'android':'desktop'});
 if(error)throw error;
 await navigator.serviceWorker.ready;
 return {status:'granted' as const,endpoint:sub.endpoint};
}
export async function disablePush(){
 const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(!sub)return;
 const endpoint=sub.endpoint;await sub.unsubscribe();
 const {error}=await supabase.from('push_subscriptions').delete().eq('endpoint',endpoint);if(error)throw error; await setNotificationPreferences({push_enabled:false});
}
export async function testPush(){
 const {error}=await invokeEdgeFunction('send-reminders',{body:{mode:'test'}});if(error)throw error;
}
export async function listPushDevices(){
 const {data,error}=await supabase.from('push_subscriptions').select('id,endpoint,user_agent,platform,created_at,last_seen_at,last_success_at,is_active,failure_count').order('last_seen_at',{ascending:false});
 if(error)throw error; return data??[];
}
export async function setNotificationPreferences(values:Record<string,unknown>){
 const user=(await supabase.auth.getUser()).data.user;if(!user)throw new Error('ورود به سامانه لازم است');
 const {error}=await supabase.from('notification_preferences').upsert({user_id:user.id,...values});if(error)throw error;
}
