/// <reference lib="webworker" />
import {clientsClaim} from 'workbox-core';
import {cleanupOutdatedCaches,matchPrecache,precacheAndRoute} from 'workbox-precaching';
import {registerRoute,setCatchHandler} from 'workbox-routing';
import {NetworkFirst} from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;
cleanupOutdatedCaches();
// Prefer the network when it is healthy, but do not make every app reopen wait on it.
// A previously visited route is returned from Cache Storage after a short timeout;
// fresh HTML replaces it whenever the network responds. API routes are not navigations
// and remain uncached here, so tenant-specific data and authenticated responses stay private.
registerRoute(({request,url})=>request.method==='GET'&&request.mode==='navigate'&&!['code','error','error_description','access_token','refresh_token','type'].some(key=>url.searchParams.has(key)),new NetworkFirst({
 // Do not return an old HTML shell just because a mobile connection takes >1s.
 // Old shells can reference fingerprinted JS chunks removed by a newer deployment,
 // which causes "Importing a module script failed". Offline fallback is handled below.
 cacheName:'customs-os-navigation-v6',
 networkTimeoutSeconds:1,
}));
precacheAndRoute(self.__WB_MANIFEST);

const SHARE_DB_NAME='customs-os-share-inbox-v1';
const SHARE_STORE='incoming';
function openShareDb():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(SHARE_DB_NAME,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(SHARE_STORE))request.result.createObjectStore(SHARE_STORE,{keyPath:'id'});};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}
self.addEventListener('fetch',(event:FetchEvent)=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='POST'||url.origin!==self.location.origin||url.pathname!=='/share-inbox')return;
 event.respondWith((async()=>{
  try{
   const form=await event.request.formData();
   const files=form.getAll('files').filter((item):item is File=>item instanceof File&&item.size>0);
   if(!files.length)return Response.redirect(new URL('/share-inbox?shareError=no-files',self.location.origin).toString(),303);
   const db=await openShareDb();
   await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(SHARE_STORE,'readwrite'),store=tx.objectStore(SHARE_STORE);
    for(const file of files)store.put({id:crypto.randomUUID(),name:file.name,file,createdAt:Date.now()});
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
   });
   db.close();
   return Response.redirect(new URL('/share-inbox?shared=1',self.location.origin).toString(),303);
  }catch(error){
   console.error('[Customs OS] Share Target intake failed:',error);
   return Response.redirect(new URL('/share-inbox?shareError=save-failed',self.location.origin).toString(),303);
  }
 })());
});

setCatchHandler(async({request})=>{
 if(request.mode!=='navigate')return Response.error();
 return (await matchPrecache('/index.html'))??(await matchPrecache('/offline.html'))??Response.error();
});
// Wait for an explicit user action from the update notice before taking control.
// With registerType='prompt', unconditional skipWaiting would bypass the notice and
// could replace the running app while a customs form or chat composer is open.
self.addEventListener('message', (event) => {
 if (event.data && event.data.type === 'SKIP_WAITING') {
  void self.skipWaiting();
 }
});
clientsClaim();

type PushData={title?:string;body?:string;tag?:string;url?:string;icon?:string;badge?:string;requireInteraction?:boolean;actions?:Array<{action:string;title:string;icon?:string}>;data?:Record<string,string>};
const actionUrl=(rid:string,action:string)=>'/reminders?rid='+encodeURIComponent(rid)+'&act='+encodeURIComponent(action)+'&source=push';
const isVoicePush=(data:PushData)=>data.data?.kind==='voice_call'||data.tag?.startsWith('voice-call-')===true;
self.addEventListener('push',(event)=>{
 const data=(event.data?.json?.()??{}) as PushData;
 event.waitUntil(self.registration.showNotification(data.title??(isVoicePush(data)?'تماس صوتی ورودی':'یادآور گمرکی'),{
  body:data.body??(isVoicePush(data)?'تماس صوتی ورودی دارید. برای پاسخ وارد چت سازمانی شوید.':'یک یادآور برای شما ثبت شده است.'),tag:data.tag??(isVoicePush(data)?'customs-os-voice-call':'customs-os-reminder'),
  icon:data.icon??(isVoicePush(data)?'/pwa/chat-apple-touch-icon-180.png':'/pwa/icon-192.png'),badge:data.badge??'/pwa/monochrome-96.png',dir:'rtl',lang:'fa',
  requireInteraction:data.requireInteraction??isVoicePush(data),
  ...(data.actions?{actions:data.actions}:{actions:isVoicePush(data)?[{action:'open-call',title:'باز کردن تماس'}]:[{action:'done',title:'انجام شد'},{action:'snooze10',title:'۱۰ دقیقه بعد'},{action:'tomorrow9',title:'فردا ۹ صبح'}]}),
  data:{...(data.data??{}),url:data.url??'/reminders'}
 }));
});
self.addEventListener('notificationclick',(event)=>{
 const n=event.notification,data=(n.data??{}) as Record<string,string>,rid=data.rid??'',action=event.action;
 n.close();
 const target=action&&rid?actionUrl(rid,action):(data.url??'/reminders');
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
  for(const w of windows){
   if('focus' in w){if('navigate' in w)await w.navigate(new URL(target,self.location.origin).href);return w.focus();}
  }
  return self.clients.openWindow(new URL(target,self.location.origin).href);
 }));
});
self.addEventListener('notificationclose',(event)=>{
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(w=>{for(const c of w)c.postMessage({type:'NOTIFICATION_CLOSED',tag:event.notification.tag});}));
});
self.addEventListener('pushsubscriptionchange',(event)=>{
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(w=>{for(const c of w)c.postMessage({type:'PUSH_SUBSCRIPTION_CHANGED'});}));
});
