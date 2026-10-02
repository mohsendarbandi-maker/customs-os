/// <reference lib="webworker" />
import {cleanupOutdatedCaches,clientsClaim} from 'workbox-core';
import {precacheAndRoute} from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
self.skipWaiting();
clientsClaim();

type PushData={title?:string;body?:string;tag?:string;url?:string;icon?:string;badge?:string;requireInteraction?:boolean;actions?:NotificationAction[];data?:Record<string,string>};
const openAction=(rid:string,action:string)=>'/reminders?rid='+encodeURIComponent(rid)+'&act='+encodeURIComponent(action)+'&source=push';

self.addEventListener('push',(event)=>{
 const data=(event.data?.json?.()??{}) as PushData;
 event.waitUntil(self.registration.showNotification(data.title??'یادآور گمرکی',{
  body:data.body??'یک یادآور برای شما ثبت شده است.',
  tag:data.tag??'customs-os-reminder',
  icon:data.icon??'/pwa/icon-192.png',badge:data.badge??'/pwa/badge-96.png',
  dir:'rtl',lang:'fa',requireInteraction:data.requireInteraction??false,
  actions:data.actions??[
   {action:'done',title:'انجام شد'},
   {action:'snooze10',title:'۱۰ دقیقه بعد'},
   {action:'tomorrow9',title:'فردا ۹ صبح'}
  ],
  data:{...(data.data??{}),url:data.url??'/reminders'}
 }));
});
self.addEventListener('notificationclick',(event)=>{
 const n=event.notification,data=(n.data??{}) as Record<string,string>,rid=data.rid??'',action=event.action;
 n.close();
 const target=action&&rid?openAction(rid,action):(data.url??'/reminders');
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
  for(const w of windows){
   if('focus' in w){
    if('navigate' in w){await w.navigate(new URL(target,self.location.origin).href);}
    return w.focus();
   }
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
