import React,{useEffect,useState} from 'react';
import {CloudOff,Cloud,RefreshCw} from 'lucide-react';
import {flushOfflineQueue,listQueue,startOfflineQueue,subscribeOfflineQueue} from '../lib/offlineQueue';

export const OfflineQueueStatus:React.FC=()=>{
 const [online,setOnline]=useState(()=>navigator.onLine);
 const [count,setCount]=useState(0);
 const [syncing,setSyncing]=useState(false);
 useEffect(()=>{
  const refresh=async()=>setCount((await listQueue()).length);
  const off=subscribeOfflineQueue(items=>setCount(items.length));
  const on=()=>setOnline(true),offLine=()=>setOnline(false);
  window.addEventListener('online',on);window.addEventListener('offline',offLine);
  const stop=startOfflineQueue();void refresh();
  return()=>{off();stop();window.removeEventListener('online',on);window.removeEventListener('offline',offLine)};
 },[]);
 const sync=async()=>{setSyncing(true);try{await flushOfflineQueue()}finally{setSyncing(false)}};
 return <div className="fixed left-4 bottom-4 z-50 flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs text-slate-200 shadow-2xl backdrop-blur">
  {online?<Cloud size={15}/>:<CloudOff size={15}/>}<span>{online?'آنلاین':'آفلاین'}</span>
  {count>0&&<><span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">صف {count}</span><button disabled={syncing||!online} onClick={sync} className="rounded-lg border border-slate-700 p-1.5 disabled:opacity-50" title="همگام‌سازی صف"><RefreshCw size={13} className={syncing?'animate-spin':''}/></button></>}
 </div>;
};
