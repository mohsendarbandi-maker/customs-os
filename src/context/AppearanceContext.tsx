import React,{createContext,useContext,useEffect,useMemo,useState}from'react';
import{useAuth}from'./AuthContext';
import{readUserSettings,writeUserSettings}from'../lib/userSettingsStorage';

type ThemeMode='light'|'dark';
type ComfortMode='normal'|'soft'|'warm'|'reading';
type Density='comfortable'|'compact';
type LayoutPreset='standard'|'cards'|'compact';
type AppearanceState={
 theme:ThemeMode;
 accentColor:string;
 comfort:ComfortMode;
 density:Density;
 layoutPreset:LayoutPreset;
 sidebarCollapsed:boolean;
 setTheme:(v:ThemeMode)=>void;
 setAccentColor:(v:string)=>void;
 setComfort:(v:ComfortMode)=>void;
 setDensity:(v:Density)=>void;
 setLayoutPreset:(v:LayoutPreset)=>void;
 setSidebarCollapsed:(v:boolean)=>void;
};

type StoredAppearance={
 theme:ThemeMode;
 accentColor:string;
 comfort:ComfortMode;
 density:Density;
 layoutPreset:LayoutPreset;
 sidebarCollapsed:boolean;
};

const AppearanceContext=createContext<AppearanceState|null>(null);

const defaults:StoredAppearance={
 theme:'dark',
 accentColor:'#0A66C2',
 comfort:'normal',
 density:'comfortable',
 layoutPreset:'standard',
 sidebarCollapsed:false,
};

const readAppearance=(userId:string|null|undefined):StoredAppearance=>{
 try{
  const settings=readUserSettings<Record<string,unknown>>(userId,{});
  return{
   theme:settings.theme==='light'?'light':'dark',
   accentColor:typeof settings.accentColor==='string'&&/^#[0-9a-fA-F]{6}$/.test(settings.accentColor)?settings.accentColor:defaults.accentColor,
   comfort:settings.comfort==='reading'||settings.comfort==='soft'||settings.comfort==='warm'||settings.comfort==='normal'
    ? settings.comfort
    : defaults.comfort,
   density:settings.density==='compact'?'compact':'comfortable',
   layoutPreset:settings.layoutPreset==='cards'||settings.layoutPreset==='compact'||settings.layoutPreset==='standard'?settings.layoutPreset:'standard',
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
 const setAccentColor=(v:string)=>persist({accentColor:/^#[0-9a-fA-F]{6}$/.test(v)?v:defaults.accentColor});
 const setComfort=(v:ComfortMode)=>persist({comfort:v});
 const setDensity=(v:Density)=>persist({density:v});
 const setLayoutPreset=(v:LayoutPreset)=>persist({layoutPreset:v==='cards'||v==='compact'?v:'standard'});
 const setSidebarCollapsed=(v:boolean)=>persist({sidebarCollapsed:v});

 useEffect(()=>{
  document.documentElement.style.setProperty('--primary',appearance.accentColor);
  document.documentElement.style.setProperty('--hero-b',appearance.accentColor);
  document.documentElement.dataset.theme=appearance.theme;
  document.documentElement.dataset.comfort=appearance.comfort;
  document.documentElement.dataset.density=appearance.density;
  document.documentElement.dataset.layoutPreset=appearance.layoutPreset;
  document.documentElement.dataset.sidebar=appearance.sidebarCollapsed?'collapsed':'expanded';
 },[appearance]);

 const value=useMemo(()=>({
  theme:appearance.theme,
  accentColor:appearance.accentColor,
  comfort:appearance.comfort,
  density:appearance.density,
  layoutPreset:appearance.layoutPreset,
  sidebarCollapsed:appearance.sidebarCollapsed,
  setTheme,
  setAccentColor,
  setComfort,
  setDensity,
  setLayoutPreset,
  setSidebarCollapsed,
 }),[appearance]);

 return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
};

export const useAppearance=()=>{
 const value=useContext(AppearanceContext);
 if(!value)throw new Error('useAppearance must be used within AppearanceProvider');
 return value;
};
