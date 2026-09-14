import React,{useEffect,useRef} from 'react';
import {supabase} from '../lib/supabase';
import {useAuth} from '../context/AuthContext';

const STORAGE_KEY='customs-settings';

export const SettingsPersistenceBridge:React.FC=()=>{
 const {user}=useAuth();
 const lastSerialized=useRef('');
 const ready=useRef(false);
 useEffect(()=>{
  let cancelled=false;
  const load=async()=>{
   if(!user?.id)return;
   const {data,error}=await supabase.from('user_settings').select('settings').eq('user_id',user.id).maybeSingle();
   if(cancelled)return;
   if(!error&&data?.settings&&typeof data.settings==='object'){
    try{
     const merged={...JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'),...(data.settings as Record<string,unknown>)};
     const serialized=JSON.stringify(merged);
     localStorage.setItem(STORAGE_KEY,serialized);
     lastSerialized.current=serialized;
     window.dispatchEvent(new Event('customs-settings-loaded'));
    }catch{}
   }
   ready.current=true;
  };
  load();
  const timer=window.setInterval(async()=>{
   if(cancelled||!ready.current||!user?.id)return;
   try{
    const raw=localStorage.getItem(STORAGE_KEY)||'{}';
    if(raw===lastSerialized.current)return;
    const settings=JSON.parse(raw) as Record<string,unknown>;
    const {error}=await supabase.from('user_settings').upsert({user_id:user.id,settings,updated_at:new Date().toISOString()},{onConflict:'user_id'});
    if(!error)lastSerialized.current=raw;
   }catch{}
  },1200);
  return()=>{cancelled=true;window.clearInterval(timer)};
 },[user?.id]);
 return null;
};
