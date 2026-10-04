/// <reference lib="webworker" />
import {clientsClaim} from 'workbox-core';
import {cleanupOutdatedCaches,precacheAndRoute} from 'workbox-precaching';
import {registerRoute,setCatchHandler} from 'workbox-routing';
import {NetworkFirst} from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(({request})=>request.mode==='navigate',new NetworkFirst({cacheName:'customs-os-pages-v3',networkTimeoutSeconds:5}));
setCatchHandler(async({request})=>request.mode==='navigate'?(await caches.match('/offline.html'))??Response.error():Response.error());
self.skipWaiting();
clientsClaim();

type PushData={title?:string;body?:string;tag?:string;url?:string;icon?:string;badge?:string;requireInteraction?:boolean;actions?:Array<{action:string;title:string;icon?:string}>;data?:Record<string,string>};
const actionUrl=(rid:string,action:string)=>'/reminders?rid='+encodeURIComponent(rid)+'&act='+encodeURIComponent(action)+'&source=push';
self.addEventListener('push',(event)=>{
 const data=(event.data?.json?.()??{}) as PushData;
 event.waitUntil(self.registration.showNotification(data.title??'یادآور گمرکی',{
  body:data.body??'یک یادآور برای شما ثبت شده است.',tag:data.tag??'customs-os-reminder',
  icon:data.icon??'/pwa/icon-192.png',badge:data.badge??'/pwa/monochrome-96.png',dir:'rtl',lang:'fa',
  requireInteraction:data.requireInteraction??false,
  ...(data.actions?{actions:data.actions}:{actions:[{action:'done',title:'انجام شد'},{action:'snooze10',title:'۱۰ دقیقه بعد'},{action:'tomorrow9',title:'فردا ۹ صبح'}]}),
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
