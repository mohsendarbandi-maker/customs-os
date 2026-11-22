import React,{useEffect}from'react';
import{useAuth}from'../context/AuthContext';
import{readUserSettings}from'../lib/userSettingsStorage';

export const SettingsPersistenceBridge:React.FC=()=>{
 const{user}=useAuth();
 useEffect(()=>{
  if(!user?.id)return;
  // Settings remain local in the isolated recovery environment until the
  // original organization settings can be imported and validated.
  const local=readUserSettings<Record<string,unknown>>(user.id,{});
  window.dispatchEvent(new CustomEvent('customs-settings-loaded',{detail:local}));
 },[user?.id]);
 return null;
};
