import React,{useEffect,useState}from'react';
import{registerSW}from'virtual:pwa-register';
import{useLocation}from'react-router-dom';
const isIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)&&!/android/i.test(navigator.userAgent);
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
export const PwaLifecycle:React.FC=()=>{
 const[installEvent,setInstallEvent]=useState<BeforeInstallPromptEvent|null>(null),[iosGuide,setIosGuide]=useState(false),[online,setOnline]=useState(()=>navigator.onLine);
 const location=useLocation();
 const areaLabel='Customs OS';
 // One origin means theme, manifest and Apple touch icon never depend on the current route.
 // The page title may still describe the open section without creating a separate installable app.
 useEffect(()=>{
  if(location.pathname==='/login'||location.pathname==='/onboarding')return;
  document.title=location.pathname.startsWith('/reminders')?'یادآورها | Customs OS':location.pathname.startsWith('/chat')?'چت سازمانی | Customs OS':'Customs OS | سیستم مدیریت گمرک';
 },[location.pathname]);
 useEffect(()=>{let updater:((reloadPage?:boolean)=>Promise<void>)|null=null;let cancelled=false;let timer:ReturnType<typeof setTimeout>|null=null;const start=()=>{timer=setTimeout(()=>{if(cancelled)return;try{updater=registerSW({immediate:true,onNeedRefresh:()=>{if(updater)void updater(false).catch((error)=>console.warn('[PWA] silent update failed:',error));},onNeedReload:()=>undefined,onOfflineReady:()=>undefined,onRegisterError:(error)=>console.warn('[PWA] service worker registration failed:',error)});}catch(error){console.error('[PWA] service worker registration failed:',error);}},1500)};if(document.readyState==='complete')start();else window.addEventListener('load',start,{once:true});const onInstall=(e:Event)=>{e.preventDefault();setInstallEvent(e as BeforeInstallPromptEvent)},onOnline=()=>setOnline(true),onOffline=()=>setOnline(false);window.addEventListener('beforeinstallprompt',onInstall);window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline);return()=>{cancelled=true;if(timer)clearTimeout(timer);window.removeEventListener('load',start);window.removeEventListener('beforeinstallprompt',onInstall);window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline)}},[]);
 useEffect(()=>{const vv=window.visualViewport;if(!vv)return;const set=()=>document.documentElement.style.setProperty('--reminder-keyboard-height',Math.max(0,window.innerHeight-vv.height)+'px');set();vv.addEventListener('resize',set);vv.addEventListener('scroll',set);return()=>{vv.removeEventListener('resize',set);vv.removeEventListener('scroll',set)}},[]);
 useEffect(()=>{try{if(isIos()&&!standalone()&&localStorage.getItem('customs-os-ios-install-dismissed')!=='1')setIosGuide(true)}catch(error){console.warn('[PWA] localStorage unavailable:',error)}},[]);
 const install=async()=>{if(!installEvent)return;await installEvent.prompt();setInstallEvent(null)};
 const dismissIos=()=>{try{localStorage.setItem('customs-os-ios-install-dismissed','1')}catch(error){console.warn('[PWA] unable to persist iOS guide state:',error)}setIosGuide(false)};
 return <>{installEvent&&!standalone()&&<div dir="rtl" className="pwa-install-prompt fixed bottom-4 right-4 left-4 md:left-auto md:w-[380px] z-[500] rounded-2xl border app-border bg-[var(--surface)] p-4 shadow-2xl"><b>نصب {areaLabel}</b><p className="text-xs app-muted mt-1">برای دسترسی سریع، اجرای مستقیم {areaLabel} و اعلان‌های واقعی، آن را به صفحه اصلی اضافه کنید.</p><div className="flex gap-2 mt-3"><button onClick={()=>void install()} className="min-h-11 flex-1 rounded-xl bg-[var(--primary)] text-white font-bold">نصب برنامه</button><button onClick={()=>setInstallEvent(null)} className="min-h-11 px-4 rounded-xl border app-border">بعداً</button></div></div>}
 {iosGuide&&!standalone()&&<div dir="rtl" className="pwa-ios-install-guide fixed inset-x-3 bottom-3 z-[500] rounded-2xl border app-border bg-[var(--surface)] p-4 shadow-2xl"><b>نصب {areaLabel} در آیفون</b><ol className="text-xs app-muted mt-2 space-y-1 pr-4 list-decimal"><li>دکمه «اشتراک‌گذاری» را در Safari بزنید.</li><li>گزینه «افزودن به صفحه اصلی» را انتخاب کنید.</li><li>{areaLabel} را از صفحه اصلی باز کنید؛ همان بخش مستقیماً باز می‌شود.</li></ol><div className="flex gap-2 mt-3"><button onClick={dismissIos} className="min-h-11 flex-1 rounded-xl bg-[var(--primary)] text-white font-bold">متوجه شدم</button><button onClick={()=>setIosGuide(false)} className="min-h-11 px-4 rounded-xl border app-border">بستن</button></div></div>}
 {!online&&<div dir="rtl" className="fixed top-[calc(66px+env(safe-area-inset-top))] inset-x-3 z-[300] rounded-xl bg-[var(--surface)] border app-border px-3 py-2 text-xs shadow-lg">آفلاین · داده‌های ذخیره‌شده ممکن است قدیمی باشند؛ ثبت جدید صف می‌شود، ویرایش و تغییر وضعیت نیازمند اینترنت است.</div>}
 </>;
};
export const isPwaInstalled=standalone;
type BeforeInstallPromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed';platform:string}>};
