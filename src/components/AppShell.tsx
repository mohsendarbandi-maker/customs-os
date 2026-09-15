import React,{useState} from 'react';
import {NavLink,useLocation,useNavigate} from 'react-router-dom';
import {Activity,Anchor,BarChart3,Building2,Calculator,ChevronLeft,ChevronRight,FileCheck2,FileText,FileSearch,History,LayoutDashboard,Menu,Palette,Printer,Settings2,ShieldCheck,Ship,Truck,X,LogOut,Sun,Moon,BookOpen,Wallet,ClipboardList,FolderOpen} from 'lucide-react';
import {useAuth,UserRole} from '../context/AuthContext';
import {useAppearance} from '../context/AppearanceContext';
import {OfflineQueueStatus} from './OfflineQueueStatus';
import {AIWorkspace} from './AIWorkspace';

type NavItem={label:string;en:string;to:string;icon:React.ElementType;group:string;roles?:UserRole[]};
const allStaff:UserRole[]=['owner','admin','broker','accountant','warehouse'];
const management:UserRole[]=['owner','admin','broker'];
const finance:UserRole[]=['owner','admin','accountant'];
const nav:NavItem[]=[
 {label:'داشبورد',en:'Dashboard',to:'/',icon:LayoutDashboard,group:'عملیات'},
 {label:'مرکز کنترل',en:'Control Center',to:'/control',icon:Activity,group:'عملیات',roles:management},
 {label:'عملیات پرونده',en:'Cases & Operations',to:'/operations',icon:BarChart3,group:'عملیات',roles:['owner','admin','broker','warehouse','client']},
 {label:'یادآورها',en:'Reminders',to:'/reminders',icon:ClipboardList,group:'عملیات'},
 {label:'عملیات دریایی',en:'Maritime Operations',to:'/maritime',icon:Anchor,group:'حمل و اسناد',roles:management},
 {label:'جستجوی کشتی',en:'Vessel Search',to:'/vessel-search',icon:Ship,group:'حمل و اسناد',roles:allStaff},
 {label:'صاحب کالا',en:'Clients',to:'/clients',icon:Building2,group:'حمل و اسناد',roles:management},
 {label:'فایل‌منیجر اسناد محموله',en:'Shipment Documents',to:'/documents/extract',icon:FolderOpen,group:'حمل و اسناد',roles:['owner','admin','broker','warehouse','client']},
 {label:'۱- ورود اطلاعات قبل اظهار',en:'Pre-Declaration',to:'/operations?tab=pre-declaration',icon:ClipboardList,group:'گمرکی',roles:['owner','admin','broker','client']},
 {label:'۲- اظهار / EPL',en:'Declaration / EPL',to:'/operations?tab=declaration',icon:FileCheck2,group:'گمرکی',roles:management},
 {label:'۳- پروانه / درب خروج',en:'Permit / Exit',to:'/exit',icon:Truck,group:'گمرکی',roles:['owner','admin','broker','warehouse']},
 {label:'ارزش‌گذاری',en:'Valuation',to:'/operations?tab=pre-declaration',icon:Calculator,group:'ترخیص',roles:management},
 {label:'اسناد و مجوزها',en:'Documents & Permits',to:'/documents/extract',icon:FileText,group:'ترخیص',roles:['owner','admin','broker','warehouse','client']},
 {label:'استخراج هوشمند اسناد',en:'Document Intelligence',to:'/documents/extract',icon:FileSearch,group:'ترخیص',roles:['owner','admin','broker','warehouse','client']},
 {label:'قواعد مجوز',en:'Permit Rules',to:'/permit-rules',icon:ShieldCheck,group:'ترخیص',roles:management},
 {label:'مالی',en:'Finance',to:'/finance',icon:Wallet,group:'مالی و خروج',roles:finance},
 {label:'خروج کالا',en:'Cargo Exit',to:'/exit',icon:Truck,group:'مالی و خروج',roles:['owner','admin','broker','warehouse']},
 {label:'مراحل پرونده',en:'Case Stages',to:'/stage',icon:History,group:'کنترل',roles:management},
 {label:'تاریخچه و Audit',en:'History & Audit',to:'/history',icon:History,group:'کنترل',roles:allStaff},
 {label:'چاپ اظهار',en:'Declaration Print',to:'/print-declaration',icon:Printer,group:'کنترل',roles:management},
 {label:'تنظیمات',en:'Settings',to:'/settings',icon:Settings2,group:'سیستم'}
];
const groups=['عملیات','حمل و اسناد','گمرکی','ترخیص','مالی و خروج','کنترل','سیستم'];
const roles:Record<string,string>={owner:'مالک',admin:'مدیر',broker:'کارگزار',accountant:'حسابدار',warehouse:'انبار',client:'صاحب کالا'};
const canSee=(item:NavItem,role?:UserRole|null)=>!item.roles||!!role&&item.roles.includes(role);
export const AppShell:React.FC<{children:React.ReactNode}>=({children})=>{
 const location=useLocation(),navigate=useNavigate(),{profile,signOut}=useAuth();
 const{theme,setTheme,comfort,setComfort,density,setDensity,sidebarCollapsed,setSidebarCollapsed}=useAppearance();
 const[mobileOpen,setMobileOpen]=useState(false),[appearanceOpen,setAppearanceOpen]=useState(false);
 const bare=location.pathname==='/login'||location.pathname==='/onboarding';if(bare)return <>{children}</>;
 const visibleNav=nav.filter(x=>canSee(x,profile?.role));
 const isActive=(to:string)=>{const[target,qs]=to.split('?');if(location.pathname!==target)return false;const tab=qs?new URLSearchParams(qs).get('tab'):null;return tab?new URLSearchParams(location.search).get('tab')===tab:!new URLSearchParams(location.search).get('tab')};
 const cycleTheme=()=>{if(comfort==='reading'){setComfort('normal');setTheme('dark');return}if(theme==='dark'){setTheme('light');setComfort('normal');return}setComfort('reading')};
 const appearanceLabel=comfort==='reading'?'کتابخوان':theme==='light'?'روز':'شب';
 return <div className="app-shell min-h-screen" dir="rtl">
  <aside className={`app-sidebar hidden md:flex ${sidebarCollapsed?'is-collapsed':''}`}><div className="app-brand"><div className="app-brand-mark"><Ship size={22}/></div>{!sidebarCollapsed&&<div className="min-w-0"><div className="font-black tracking-tight">Customs OS</div><div className="text-[10px] app-muted">Customs & Logistics</div></div>}</div>
   <nav className="flex-1 overflow-y-auto px-2 pb-4">{groups.map(g=><div key={g} className="mb-4"><div className="app-nav-group">{!sidebarCollapsed&&g}</div>{visibleNav.filter(x=>x.group===g).map(item=>{const Icon=item.icon;return <NavLink key={item.to} to={item.to} className={`app-nav-item ${isActive(item.to)?'active':''}`} title={sidebarCollapsed?item.label:undefined}><Icon size={19}/>{!sidebarCollapsed&&<span className="min-w-0"><span className="block text-sm font-semibold truncate">{item.label}</span><span className="block text-[10px] app-muted truncate">{item.en}</span></span>}</NavLink>})}</div>)}</nav>
   <div className="p-2"><button className="app-nav-item w-full" onClick={()=>navigate('/settings/appearance')}><Palette size={18}/>{!sidebarCollapsed&&<span>ظاهر و شخصی‌سازی</span>}</button><button className="app-nav-item w-full" onClick={()=>setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed?<ChevronLeft size={18}/>:<ChevronRight size={18}/>} {!sidebarCollapsed&&<span>جمع‌کردن منو</span>}</button></div>
  </aside>
  <div className="app-mobilebar md:hidden"><button className="icon-btn" aria-label="منو" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button><button className="app-mobile-title" onClick={()=>navigate('/')}><span className="app-brand-mark"><Ship size={17}/></span><span>Customs OS</span></button><button className="icon-btn" aria-label="ظاهر" onClick={cycleTheme}>{comfort==='reading'?<BookOpen size={18}/>:theme==='light'?<Sun size={18}/>:<Moon size={18}/>}</button></div>
  {mobileOpen&&<><div className="app-scrim md:hidden" onClick={()=>setMobileOpen(false)}/><aside className="app-mobile-drawer md:hidden"><div className="flex items-center justify-between p-4 border-b app-border"><b>Customs OS</b><button className="icon-btn" onClick={()=>setMobileOpen(false)}><X size={18}/></button></div><nav className="p-2 overflow-y-auto">{visibleNav.map(item=>{const Icon=item.icon;return <NavLink key={item.to} to={item.to} onClick={()=>setMobileOpen(false)} className={`app-nav-item ${isActive(item.to)?'active':''}`}><Icon size={18}/><span><span className="block text-sm font-semibold">{item.label}</span><span className="block text-[10px] app-muted">{item.en}</span></span></NavLink>})}</nav></aside></>}
  <main className={`app-main ${sidebarCollapsed?'sidebar-compact':''}`}><header className="app-topbar"><div className="flex items-center gap-3 min-w-0"><div className="hidden lg:block"><div className="text-[11px] app-muted">سامانه مدیریت عملیات گمرکی و لجستیک</div><div className="font-bold truncate">{location.pathname.startsWith('/settings')?'تنظیمات':visibleNav.find(x=>isActive(x.to))?.label||'Customs OS'}</div></div><div className="flex-1"/><div className="flex items-center gap-2"><button className="theme-cycle-btn" title="تغییر حالت نمایش" onClick={cycleTheme}>{comfort==='reading'?<BookOpen size={16}/>:theme==='light'?<Sun size={16}/>:<Moon size={16}/>}<span className="hidden sm:inline">{appearanceLabel}</span></button><span className="hidden lg:inline app-user-chip"><span className="h-7 w-7 rounded-full grid place-items-center bg-[var(--primary)] text-white text-xs font-black">{(profile?.full_name||'C').slice(0,1)}</span><span className="text-xs"><b>{profile?.full_name||'کاربر'}</b><span className="block app-muted">{roles[profile?.role||'']||''}</span></span></span><button className="icon-btn" title="تنظیمات" onClick={()=>navigate('/settings')}><Settings2 size={18}/></button><button className="icon-btn" title="خروج" onClick={()=>signOut()}><LogOut size={18}/></button></div></div></header>
   {appearanceOpen&&<div className="appearance-panel"><b>ظاهر سامانه</b><div className="text-[11px] app-muted mt-1 mb-3">با هر بار کلیک: روز ← کتابخوان ← شب</div><div className="grid grid-cols-3 gap-2"><button onClick={()=>{setTheme('dark');setComfort('normal')}} className="theme-choice"><Moon size={16}/>شب</button><button onClick={()=>{setTheme('light');setComfort('normal')}} className="theme-choice"><Sun size={16}/>روز</button><button onClick={()=>setComfort('reading')} className="theme-choice"><BookOpen size={16}/>کتابخوان</button></div><div className="text-xs font-semibold mt-4 mb-2">تراکم</div><div className="segmented">{(['comfortable','compact'] as const).map(v=><button key={v} onClick={()=>setDensity(v)} className={density===v?'selected':''}>{v==='comfortable'?'راحت':'فشرده'}</button>)}</div></div>}
   <div className="app-content">{children}</div>
  </main><OfflineQueueStatus/><AIWorkspace pageContext={location.pathname+location.search}/></div>;
};
