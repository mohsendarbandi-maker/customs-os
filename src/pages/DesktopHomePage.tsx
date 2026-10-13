import React,{useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpLeft,Briefcase,CloudSun,FileText,Search,Settings,Ship,Wallet,Wind,Activity,Plus,Clock3,Menu,PackageCheck,Building2,ChevronLeft} from 'lucide-react';
import {supabase} from '../lib/supabase';
import {LatestShipmentStatuses} from '../components/LatestShipmentStatuses';
import {RemindersHomeCard} from '../features/reminders/RemindersHomeCard';

const ports=[{name:'انزلی',lat:37.4727,lon:49.4587},{name:'آستارا',lat:38.429,lon:48.875},{name:'امیرآباد',lat:36.925,lon:53.420},{name:'نوشهر',lat:36.648,lon:51.496},{name:'فریدونکنار',lat:36.686,lon:52.523},{name:'ترکمن',lat:36.901,lon:54.071},{name:'بندر گز',lat:36.756,lon:53.947}];
const faDate=new Intl.DateTimeFormat('fa-IR-u-ca-persian',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
const faTime=new Intl.DateTimeFormat('fa-IR',{hour:'2-digit',minute:'2-digit'});
const Glass=({children,className='' }:{children:React.ReactNode;className?:string})=><section className={`border border-[var(--border)] bg-[var(--surface)] rounded-xl ${className}`}>{children}</section>;

export const DesktopHomePage:React.FC=()=>{
 const[now,setNow]=useState(new Date()),[port,setPort]=useState(ports[0]),[weather,setWeather]=useState<any>(null),[stats,setStats]=useState({shipments:0,clients:0,cases:0,active:0,activeCases:0});
 useEffect(()=>{const id=window.setInterval(()=>setNow(new Date()),1000);return()=>window.clearInterval(id)},[]);
 useEffect(()=>{let cancelled=false;fetch(`https://api.open-meteo.com/v1/forecast?latitude=${port.lat}&longitude=${port.lon}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`).then(r=>r.json()).then(j=>{if(!cancelled)setWeather(j.current)}).catch(()=>setWeather(null));return()=>{cancelled=true}},[port]);
 useEffect(()=>{let cancelled=false;(async()=>{const[sh,cl,cs]=await Promise.all([supabase.from('shipments').select('id,current_status'),supabase.from('clients').select('id'),supabase.from('cases').select('id,status')]);if(cancelled)return;const shipments=sh.data||[],cases=cs.data||[];setStats({shipments:shipments.length,clients:(cl.data||[]).length,cases:cases.length,active:shipments.filter((x:any)=>!['cleared','archived','closed'].includes(String(x.current_status||'').toLowerCase())).length,activeCases:cases.filter((x:any)=>!['closed','archived','completed','cancelled'].includes(String(x.status||'').toLowerCase())).length})})().catch(()=>{});return()=>{cancelled=true}},[]);
 const weatherText=useMemo(()=>{const c=weather?.weather_code;if(c===0)return'صاف';if([1,2,3].includes(c))return'نیمه‌ابری';if([45,48].includes(c))return'مه';if([51,53,55,61,63,65,80,81,82].includes(c))return'بارش';if([95,96,99].includes(c))return'رعدوبرق';return'—'},[weather]);
 return <main dir="rtl" className="customs-home min-h-screen text-[var(--text)]" style={{background:'var(--bg)'}}>
  <div className="w-full mx-auto px-4 sm:px-6 xl:px-8 py-5 lg:py-7">
   <header className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-5 border-b border-[var(--border)]">
    <div className="flex items-center gap-3"><div className="customs-home-mark"><Ship size={24}/><span/></div><div><div className="text-[10px] font-bold tracking-[.22em] text-[var(--primary)] mb-1">CUSTOMS & LOGISTICS MANAGEMENT</div><h1 className="text-xl lg:text-2xl font-black tracking-tight">میزکار عملیاتی</h1><p className="text-xs app-muted mt-1">{faDate.format(now)} <span className="mx-1 opacity-40">/</span> {faTime.format(now)}</p></div></div>
    <div className="flex items-center gap-2"><Link to="/settings" className="customs-line-button" aria-label="تنظیمات"><Settings size={17}/><span className="hidden sm:inline">تنظیمات</span></Link><Link to="/operations?tab=pre-declaration" className="customs-primary-button"><Plus size={16}/>ثبت محموله</Link></div>
   </header>
   <section className="customs-stat-line mb-6" aria-label="نمای کلی سازمان">
    {[{label:'کل محموله‌ها',value:stats.shipments,icon:Ship,to:'/operations'},{label:'در جریان عملیات',value:stats.active,icon:Activity,to:'/operations'},{label:'پرونده‌های صاحبان کالا',value:stats.clients,icon:Building2,to:'/clients'},{label:'پرونده‌های در جریان',value:stats.activeCases,icon:Briefcase,to:'/cases'}].map(({label,value,icon:Icon,to},i)=><React.Fragment key={label}><Link to={to} className="customs-stat" aria-label={label}><Icon size={17} className="text-[var(--primary)]"/><span className="text-xs app-muted">{label}</span><strong>{value}</strong></Link>{i<3&&<span className="customs-stat-divider"/>}</React.Fragment>)}
   </section>
   <section className="customs-shipments-section">
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-1 border-b border-[var(--border)]"><div><div className="text-[10px] tracking-widest text-[var(--primary)] font-bold mb-1">LIVE OPERATIONS</div><h2 className="text-lg font-black">وضعیت محموله‌ها</h2><p className="text-xs app-muted mt-1">مراحل عملیات در یک نگاه؛ از ثبت محموله تا خروج گمرکی</p></div><Link to="/operations" className="customs-line-button">همه محموله‌ها <ChevronLeft size={15}/></Link></div>
    <div className="customs-status-board"><LatestShipmentStatuses/></div>
   </section>
   <section className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-4 mt-7">
    <Glass className="p-4 lg:p-5"><div className="flex items-center justify-between gap-3 mb-4"><div><div className="text-[10px] tracking-widest text-[var(--primary)] font-bold mb-1">PORT CONDITIONS</div><h2 className="font-black">وضعیت بندر</h2></div><Ship size={19} className="app-muted"/></div><div className="flex flex-wrap items-center justify-between gap-4"><div><select value={port.name} onChange={e=>setPort(ports.find(p=>p.name===e.target.value)||ports[0])} className="bg-transparent border-b border-[var(--border)] pb-2 text-sm font-bold outline-none"><option className="text-slate-900" value={port.name}>{port.name}</option>{ports.filter(p=>p.name!==port.name).map(p=><option className="text-slate-900" key={p.name} value={p.name}>{p.name}</option>)}</select><div className="flex items-baseline gap-2 mt-3"><span className="text-3xl font-black">{weather?.temperature_2m!=null?Math.round(weather.temperature_2m):'—'}°</span><span className="text-xs app-muted">{weatherText}</span></div></div><div className="text-xs app-muted flex items-center gap-2"><Wind size={15}/>{weather?.wind_speed_10m??'—'} km/h</div></div></Glass>
    <Glass className="p-4 lg:p-5"><div className="flex items-center gap-2 mb-3"><Clock3 size={17} className="text-[var(--primary)]"/><h2 className="font-black">دسترسی‌های پرکاربرد</h2></div><div className="grid grid-cols-2 lg:grid-cols-1 gap-2">{[{label:'عملیات پرونده',to:'/operations',icon:Briefcase},{label:'اسناد',to:'/documents',icon:FileText},{label:'امور مالی',to:'/finance',icon:Wallet},{label:'یادآورها',to:'/reminders',icon:Clock3}].map(({label,to,icon:Icon})=><Link key={to} to={to} className="customs-shortcut"><Icon size={16}/><span>{label}</span><ArrowUpLeft size={13} className="mr-auto opacity-50"/></Link>)}</div></Glass>
   </section>
   <div className="mt-5"><RemindersHomeCard/></div>
  </div>
 </main>;
};
