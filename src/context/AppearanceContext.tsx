import React,{createContext,useContext,useEffect,useMemo,useState}from'react';
import{useAuth}from'./AuthContext';
import{readUserSettings,userSettingsStorageKey,writeUserSettings}from'../lib/userSettingsStorage';

type ThemeMode='light'|'dark';
type ComfortMode='normal'|'soft'|'warm'|'reading';
type Density='comfortable'|'compact';
type AppearanceState={
 theme:ThemeMode;
 comfort:ComfortMode;
 density:Density;
 sidebarCollapsed:boolean;
 setTheme:(v:ThemeMode)=>void;
 setComfort:(v:ComfortMode)=>void;
 setDensity:(v:Density)=>void;
 setSidebarCollapsed:(v:boolean)=>void;
};

type StoredAppearance={
 theme:ThemeMode;
 comfort:ComfortMode;
 density:Density;
 sidebarCollapsed:boolean;
};

const AppearanceContext=createContext<AppearanceState|null>(null);

const defaults:StoredAppearance={
 theme:'dark',
 comfort:'normal',
 density:'comfortable',
 sidebarCollapsed:false,
};

const readAppearance=(userId:string|null|undefined):StoredAppearance=>{
 try{
  const settings=readUserSettings<Record<string,unknown>>(userId,{});
  return{
   theme:settings.theme==='light'?'light':'dark',
   comfort:settings.comfort==='reading'||settings.comfort==='soft'||settings.comfort==='warm'||settings.comfort==='normal'
    ? settings.comfort
    : defaults.comfort,
   density:settings.density==='compact'?'compact':'comfortable',
   sidebarCollapsed:settings.sidebarCollapsed===true,
  };
 }catch{
  return defaults;
 }
};

export const AppearanceProvider:React.FC<{children:React.ReactNode}>=({children})=>{
 const{user}=useAuth();
 const[appearance,setAppearance]=useState<StoredAppearance>(()=>readAppearance(user?.id));

 useEffect(()=>{
  setAppearance(readAppearance(user?.id));
 },[user?.id]);

 useEffect(()=>{
  const onSettingsLoaded=()=>{
   setAppearance(readAppearance(user?.id));
  };
  window.addEventListener('customs-settings-loaded',onSettingsLoaded);
  return()=>window.removeEventListener('customs-settings-loaded',onSettingsLoaded);
 },[user?.id]);

 const persist=(patch:Partial<StoredAppearance>)=>{
  setAppearance(current=>{
   const next={...current,...patch};
   const existing=readUserSettings<Record<string,unknown>>(user?.id,{});
   writeUserSettings(user?.id,{...existing,...next});
   return next;
  });
 };

 const setTheme=(v:ThemeMode)=>persist({theme:v});
 const setComfort=(v:ComfortMode)=>persist({comfort:v});
 const setDensity=(v:Density)=>persist({density:v});
 const setSidebarCollapsed=(v:boolean)=>persist({sidebarCollapsed:v});

 useEffect(()=>{
  document.documentElement.dataset.theme=appearance.theme;
  document.documentElement.dataset.comfort=appearance.comfort;
  document.documentElement.dataset.density=appearance.density;
  document.documentElement.dataset.sidebar=appearance.sidebarCollapsed?'collapsed':'expanded';
 },[appearance]);

 const value=useMemo(()=>({
  theme:appearance.theme,
  comfort:appearance.comfort,
  density:appearance.density,
  sidebarCollapsed:appearance.sidebarCollapsed,
  setTheme,
  setComfort,
  setDensity,
  setSidebarCollapsed,
 }),[appearance]);

 return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
};

export const useAppearance=()=>{
 const value=useContext(AppearanceContext);
 if(!value)throw new Error('useAppearance must be used within AppearanceProvider');
 return value;
};
