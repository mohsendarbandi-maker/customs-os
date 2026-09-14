import React,{useState} from 'react';
import {NavLink,useLocation,useNavigate} from 'react-router-dom';
import {Activity,Anchor,BarChart3,Building2,Calculator,ChevronLeft,ChevronRight,FileCheck2,FileText,History,LayoutDashboard,Menu,Palette,Printer,Settings2,ShieldCheck,Ship,Truck,X,LogOut,Sun,Moon,Wallet} from 'lucide-react';
import {useAuth} from '../context/AuthContext';
import {useAppearance} from '../context/AppearanceContext';
import {OfflineQueueStatus} from './OfflineQueueStatus';
const nav=[
 {label:'داشبورد',en:'Dashboard',to:'/',icon:LayoutDashboard,group:'عملیات'},
 {label:'مرکز کنترل',en:'Control Center',to:'/control',icon:Activity,group:'عملیات'},
 {label:'عملیات پرونده',en:'Cases & Operations',to:'/operations',icon:BarChart3,group:'عملیات'},
 {label:'کشتیرانی',en:'Maritime',to:'/maritime',icon:Anchor,group:'حمل و اسناد'},
 {label:'صاحب کالا',en:'Clients',to:'/clients',icon:Building2,group:'حمل و اسناد'},
 {label:'اظهار / EPL',en:'Declaration / EPL',to:'/operations?tab=declaration',icon:FileCheck2,group:'ترخیص'},
 {label:'ارزش‌گذاری',en:'Valuation',to:'/operations?tab=valuation',icon:Calculator,group:'ترخیص'},
 {label:'اسناد و مجوزها',en:'Documents & Permits',to:'/operations?tab=documents',icon:FileText,group:'ترخیص'},
 {label:'قواعد مجوز',en:'Permit Rules',to:'/permit-rules',icon:ShieldCheck,group:'ترخیص'},
 {label:'مالی',en:'Finance',to:'/finance',icon:Wallet,group:'مالی و خروج'},
 {label:'خروج کالا',en:'Cargo Exit',to:'/exit',icon:Truck,group:'مالی و خروج'},
 {label:'مراحل پرونده',en:'Case Stages',to:'/stage',icon:History,group:'کنترل'},
 {label:'تاریخچه و Audit',en:'History & Audit',to:'/history',icon:History,group:'کنترل'},
 {label:'چاپ اظهار',en:'Declaration Print',to:'/print-declaration',icon:Printer,group:'کنترل'},
 {label:'تنظیمات',en:'Settings',to:'/settings',icon:Settings2,group:'سیستم'},
];
const groups=['عملیات','حمل و اسناد','ترخیص','مالی و خروج','کنترل','سیستم'];
const roles:Record<string,string>={owner:'مالک',admin:'مدیر',broker:'کارگزار',accountant:'حسابدار',warehouse:'انبار',client:'صاحب کالا'};
export const AppShell:React.FC<{children:React.ReactNode}>=({children})=>{
 const location=useLocation();const navigate=useNavigate();const{profile,signOut}=useAuth();const{theme,setTheme,density,setDensity,sidebarCollapsed,setSidebarCollapsed}=useAppearance();
 const[mobileOpen,setMobileOpen]=useState(false);const[appearanceOpen,setAppearanceOpen]=useState(false);
 const bare=location.pathname==='/login'||location.pathname==='/onboarding';if(bare)return <>{children}</>;
 const isActive=(to:string)=>{const[target,qs]=to.split('?');if(location.pathname!==target)return false;const tab=qs?new URLSearchParams(qs).get('tab'):null;return tab?new URLSearchParams(location.search).get('tab')===tab:!new URLSearchParams(location.search).get('tab')};
 return <div className="app-shell min-h-screen" dir="rtl">
  <aside className={`app-sidebar hidden md:flex ${sidebarCollapsed?'is-collapsed':''}`}><div className="app-brand"><div className="app-brand-mark"><Ship size={22}/></div>{!sidebarCollapsed&&<div className="min-w-0"><div className="font-black tracking-tight">Customs OS</div><div className="text-[10px] app-muted truncate">Customs & Logistics</div></div>}</div><nav className="flex-1 overflow-y-auto px-2 pb-4">{groups.map(g=><div key={g} className="mb-4"><div className="app-nav-group">{!sidebarCollapsed&&g}</div>{nav.filter(x=>x.group===g).map(item=>{const Icon=item.icon;return <NavLink key={item.to} to={item.to} onClick={()=>setMobileOpen(false)} className={`app-nav-item ${isActive(item.to)?'active':''}`} title={sidebarCollapsed?item.label:undefined}><Icon size={18}/>{!sidebarCollapsed&&<span className="min-w-0"><span className="block text-sm font-semibold truncate">{item.label}</span><span className="block text-[10px] app-muted truncate">{item.en}</span></span>}</NavLink>})}</div>)}</nav><div className="p-2"><button className="app-nav-item w-full" onClick={()=>navigate('/settings/appearance')}><Palette size={18}/>{!sidebarCollapsed&&<span>ظاهر و شخصی‌سازی</span>}</button><button className="app-nav-item w-full" onClick={()=>setAppearanceOpen(v=>!v)}><Settings2 size={18}/>{!sidebarCollapsed&&<span>Quick Settings</span>}</button><button className="app-nav-item w-full" onClick={()=>setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed?<ChevronLeft size={18}/>:<ChevronRight size={18}/>} {!sidebarCollapsed&&<span>جمع‌کردن منو</span>}</button></div></aside>
  <div className="app-mobilebar md:hidden"><button className="icon-btn" aria-label="باز کردن منو" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button><button className="app-mobile-title" onClick={()=>navigate('/')}><span className="app-brand-mark"><Ship size={17}/></span><span>Customs OS</span></button><button className="icon-btn" aria-label="تنظیمات" onClick={()=>navigate('/settings')}><Settings2 size={18}/></button></div>
  {mobileOpen&&<><div className="app-scrim md:hidden" onClick={()=>setMobileOpen(false)}/><aside className="app-mobile-drawer md:hidden"><div className="flex items-center justify-between p-4 border-b app-border"><div className="flex items-center gap-2"><span className="app-brand-mark"><Ship size={19}/></span><b>Customs OS</b></div><button className="icon-btn" onClick={()=>setMobileOpen(false)}><X size={18}/></button></div><nav className="p-2 overflow-y-auto">{nav.map(item=>{const Icon=item.icon;return <NavLink key={item.to} to={item.to} onClick={()=>setMobileOpen(false)} className={`app-nav-item ${isActive(item.to)||item.to==='/settings'&&location.pathname.startsWith('/settings')?'active':''}`}><Icon size={18}/><span><span className="block text-sm font-semibold">{item.label}</span><span className="block text-[10px] app-muted">{item.en}</span></span></NavLink>})}</nav></aside></>}
  <main className={`app-main ${sidebarCollapsed?'sidebar-compact':''}`}><header className="app-topbar"><div className="flex items-center gap-3 min-w-0"><div className="hidden lg:block"><div className="text-[11px] app-muted">سامانه مدیریت عملیات گمرکی و لجستیک</div><div className="font-bold truncate">{location.pathname.startsWith('/settings')?'تنظیمات':nav.find(x=>isActive(x.to))?.label||'Customs OS'}</div></div><div className="flex-1"/><div className="hidden sm:flex items-center gap-2"><span className="app-user-chip"><span className="h-7 w-7 rounded-full grid place-items-center bg-[var(--primary)] text-white text-xs font-black">{(profile?.full_name||'C').slice(0,1)}</span><span className="text-xs"><b>{profile?.full_name||'کاربر'}</b><span className="block app-muted">{roles[profile?.role||'']||''}</span></span></span><button className="icon-btn" title="تنظیمات" onClick={()=>navigate('/settings')}><Settings2 size={18}/></button><button className="icon-btn" title="ظاهر" onClick={()=>setAppearanceOpen(v=>!v)}><Palette size={18}/></button><button className="icon-btn" title="خروج" onClick={()=>signOut()}><LogOut size={18}/></button></div></div></header>
   {appearanceOpen&&<div className="appearance-panel"><div className="flex items-center justify-between mb-3"><div><b>ظاهر سامانه</b><div className="text-[11px] app-muted">تمام صفحات از همین تم مشترک استفاده می‌کنند.</div></div><Palette size={18}/></div><div className="text-xs font-semibold mb-2">تم</div><div className="segmented grid-cols-2"><button onClick={()=>setTheme('dark')} className={theme==='dark'?'selected':''}><Moon size={14}/>تیره</button><button onClick={()=>setTheme('light')} className={theme==='light'?'selected':''}><Sun size={14}/>روشن</button></div><div className="text-xs font-semibold mt-4 mb-2">تراکم رابط</div><div className="segmented grid-cols-2">{(['comfortable','compact'] as const).map(v=><button key={v} onClick={()=>setDensity(v)} className={density===v?'selected':''}>{v==='comfortable'?'راحت':'فشرده'}</button>)}</div></div>}
   <div className="app-content">{children}</div>
  </main><OfflineQueueStatus/>
 </div>;
};
