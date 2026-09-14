import React,{createContext,useContext,useEffect,useMemo,useState} from 'react';

type ThemeMode='light'|'dark';
type ComfortMode='normal'|'soft'|'warm'|'reading';
type Density='comfortable'|'compact';
type AppearanceState={theme:ThemeMode;comfort:ComfortMode;density:Density;sidebarCollapsed:boolean;setTheme:(v:ThemeMode)=>void;setComfort:(v:ComfortMode)=>void;setDensity:(v:Density)=>void;setSidebarCollapsed:(v:boolean)=>void};
const AppearanceContext=createContext<AppearanceState|null>(null);
const read=<T,>(key:string,fallback:T):T=>{try{const v=localStorage.getItem(key);return v?JSON.parse(v) as T:fallback}catch{return fallback}};
export const AppearanceProvider:React.FC<{children:React.ReactNode}>=({children})=>{
 const[theme,setThemeState]=useState<ThemeMode>(()=>{const v=read<string>('customs-theme','dark');return v==='light'?'light':'dark'});
 const[comfort,setComfortState]=useState<ComfortMode>(()=>read('customs-comfort','normal'));
 const[density,setDensityState]=useState<Density>(()=>read('customs-density','comfortable'));
 const[sidebarCollapsed,setSidebarCollapsedState]=useState<boolean>(()=>read('customs-sidebar-collapsed',false));
 const persist=(key:string,value:unknown)=>{try{localStorage.setItem(key,JSON.stringify(value))}catch{}};
 const setTheme=(v:ThemeMode)=>{setThemeState(v);persist('customs-theme',v)};
 const setComfort=(v:ComfortMode)=>{setComfortState(v);persist('customs-comfort',v)};
 const setDensity=(v:Density)=>{setDensityState(v);persist('customs-density',v)};
 const setSidebarCollapsed=(v:boolean)=>{setSidebarCollapsedState(v);persist('customs-sidebar-collapsed',v)};
 useEffect(()=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.comfort=comfort;document.documentElement.dataset.density=density;document.documentElement.dataset.sidebar=sidebarCollapsed?'collapsed':'expanded'},[theme,comfort,density,sidebarCollapsed]);
 const value=useMemo(()=>({theme,comfort,density,sidebarCollapsed,setTheme,setComfort,setDensity,setSidebarCollapsed}),[theme,comfort,density,sidebarCollapsed]);
 return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
};
export const useAppearance=()=>{const v=useContext(AppearanceContext);if(!v)throw new Error('useAppearance must be used within AppearanceProvider');return v};
