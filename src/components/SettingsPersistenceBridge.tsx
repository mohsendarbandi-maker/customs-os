import React,{useEffect,useRef}from'react';
import{supabase}from'../lib/supabase';
import{useAuth}from'../context/AuthContext';
import{readUserSettings,userSettingsStorageKey,writeUserSettings}from'../lib/userSettingsStorage';

export const SettingsPersistenceBridge:React.FC=()=>{
 const{user}=useAuth();
 const lastSerialized=useRef('');
 const ready=useRef(false);

 useEffect(()=>{
  let cancelled=false;
  ready.current=false;
  lastSerialized.current='';

  const load=async()=>{
   if(!user?.id)return;

   const{data,error}=await supabase
    .from('user_settings')
    .select('settings')
    .eq('user_id',user.id)
    .maybeSingle();

   if(cancelled)return;

   const serverSettings=!error&&data?.settings&&typeof data.settings==='object'
     ? data.settings as Record<string,unknown>
     : {};

   const local=readUserSettings<Record<string,unknown>>(user.id,{});
   const merged={...local,...serverSettings};
   const serialized=JSON.stringify(merged);
   writeUserSettings(user.id,merged);
   lastSerialized.current=serialized;
   window.dispatchEvent(new Event('customs-settings-loaded'));
   ready.current=true;
  };

  void load();

  const timer=window.setInterval(async()=>{
   if(cancelled||!ready.current||!user?.id)return;
   try{
    const settings=readUserSettings<Record<string,unknown>>(user.id,{});
    const raw=JSON.stringify(settings);
    if(raw===lastSerialized.current)return;

    const{error}=await supabase
     .from('user_settings')
     .upsert({
      user_id:user.id,
      settings,
      updated_at:new Date().toISOString(),
     },{onConflict:'user_id'});

    if(!error)lastSerialized.current=raw;
   }catch{
    // Server sync is retried on the next bridge tick.
   }
  },1200);

  return()=>{
   cancelled=true;
   window.clearInterval(timer);
  };
 },[user?.id]);

 return null;
};
