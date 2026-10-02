import React,{useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpLeft,Bell,Briefcase,Building2,CloudSun,FileCheck2,FileText,FolderOpen,Search,Settings,Ship,Wallet,Wind,Activity,Plus,Clock3} from 'lucide-react';
import {supabase} from '../lib/supabase';
import {LatestShipmentStatuses} from '../components/LatestShipmentStatuses';
import {RemindersHomeCard} from '../features/reminders/RemindersHomeCard';

const ports=[{name:'انزلی',lat:37.4727,lon:49.4587},{name:'آستارا',lat:38.429,lon:48.875},{name:'امیرآباد',lat:36.925,lon:53.420},{name:'نوشهر',lat:36.648,lon:51.496},{name:'فریدونکنار',lat:36.686,lon:52.523},{name:'ترکمن',lat:36.901,lon:54.071},{name:'بندر گز',lat:36.756,lon:53.947}];
const faDate=new Intl.DateTimeFormat('fa-IR-u-ca-persian',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
const faTime=new Intl.DateTimeFormat('fa-IR',{hour:'2-digit',minute:'2-digit'});
const quick=[['ثبت محموله','/operations?tab=pre-declaration',Plus,'primary'],['عملیات پرونده','/operations',Briefcase,''],['کشتیرانی','/maritime',Ship,''],['اسناد','/documents',FileText,''],['مالی','/finance',Wallet,''],['یادآورها','/reminders',Clock3,''] ] as const;
const Glass=({children,className='' }:{children:React.ReactNode;className?:string})=><div className={`border border-[var(--border)] bg-[var(--surface)] rounded-2xl shadow-[0_12px_35px_rgba(2,8,23,.08)] ${className}`}>{children}</div>;

export const DesktopHomePage:React.FC=()=>{
 const[now,setNow]=useState(new Date()),[port,setPort]=useState(ports[0]),[weather,setWeather]=useState<any>(null),[stats,setStats]=useState({shipments:0,clients:0,documents:0,active:0});
 useEffect(()=>{const id=window.setInterval(()=>setNow(new Date()),1000);return()=>window.clearInterval(id)},[]);
 useEffect(()=>{let cancelled=false;fetch(`https://api.open-meteo.com/v1/forecast?latitude=${port.lat}&longitude=${port.lon}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`).then(r=>r.json()).then(j=>{if(!cancelled)setWeather(j.current)}).catch(()=>setWeather(null));return()=>{cancelled=true}},[port]);
 useEffect(()=>{let cancelled=false;(async()=>{const[sh,cl,docs]=await Promise.all([supabase.from('shipments').select('id,current_status'),supabase.from('clients').select('id'),supabase.from('shipment_documents').select('id')]);if(cancelled)return;const shipments=sh.data||[];setStats({shipments:shipments.length,clients:(cl.data||[]).length,documents:(docs.data||[]).length,active:shipments.filter((x:any)=>!['cleared','archived'].includes(x.current_status)).length})})().catch(()=>{});return()=>{cancelled=true}},[]);
 const weatherText=useMemo(()=>{const c=weather?.weather_code;if(c===0)return'صاف';if([1,2,3].includes(c))return'نیمه‌ابری';if([45,48].includes(c))return'مه';if([51,53,55,61,63,65,80,81,82].includes(c))return'بارش';if([95,96,99].includes(c))return'رعدوبرق';return'—'},[weather]);
 return <main dir="rtl" className="min-h-screen text-[var(--text)]" style={{background:'var(--bg)'}}>
  <div className="max-w-[1500px] mx-auto px-5 lg:px-8 py-6 lg:py-8">
   <header className="flex flex-wrap items-center justify-between gap-4 mb-7">
    <div><div className="text-xs font-bold text-[var(--primary)] mb-2">CUSTOMS OS · CONTROL DESK</div><h1 className="text-2xl lg:text-3xl font-black tracking-tight">میزکار عملیاتی</h1><p className="text-xs app-muted mt-2">{faDate.format(now)} · {faTime.format(now)}</p></div>
    <div className="flex items-center gap-2">
      <Link to="/reminders" className="icon-btn" aria-label="یادآورها"><Bell size={17}/></Link>
      <Link to="/settings" className="icon-btn" aria-label="تنظیمات"><Settings size={17}/></Link>
      <Link to="/operations?tab=pre-declaration" className="px-4 h-10 inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] text-white text-xs font-black shadow-lg"><Plus size={15}/>ثبت محموله</Link>
    </div>
   </header>
   <section className="grid lg:grid-cols-[1.55fr_.75fr] gap-4">
    <Glass className="p-5 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
       <div><div className="text-xs app-muted">نمای لحظه‌ای سازمان</div><h2 className="text-lg font-black mt-1">وضعیت عملیات</h2></div>
       <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full lg:w-auto">
        {[['محموله',stats.shipments],['فعال',stats.active],['صاحب کالا',stats.clients],['سند',stats.documents]].map(([label,value])=><div key={String(label)} className="min-w-[86px] px-4 py-3 rounded-xl bg-[var(--surface-2)] text-center"><div className="text-xl font-black">{value}</div><div className="text-[10px] app-muted mt-1">{label}</div></div>)}
       </div>
      </div>
    </Glass>
    <Glass className="p-5">
      <div className="flex items-center justify-between"><div><div className="text-[10px] app-muted">وضعیت بندر</div><select value={port.name} onChange={e=>setPort(ports.find(p=>p.name===e.target.value)||ports[0])} className="mt-1 bg-transparent text-sm font-black outline-none"><option className="text-slate-900" value={port.name}>{port.name}</option>{ports.filter(p=>p.name!==port.name).map(p=><option className="text-slate-900" key={p.name} value={p.name}>{p.name}</option>)}</select></div><CloudSun size={21}/></div>
      <div className="flex items-end justify-between mt-4"><div><span className="text-3xl font-black">{weather?.temperature_2m!=null?Math.round(weather.temperature_2m):'—'}°</span><span className="text-xs app-muted mr-2">{weatherText}</span></div><span className="text-[10px] app-muted"><Wind size={11} className="inline ml-1"/>{weather?.wind_speed_10m??'—'} km/h</span></div>
    </Glass>
   </section>
   <section className="grid md:grid-cols-3 gap-4 mt-4">
    <Glass className="md:col-span-2 p-5"><div className="flex items-center justify-between mb-4"><div><h2 className="font-black">آخرین وضعیت محموله‌ها</h2><p className="text-[10px] app-muted mt-1">پیگیری مستقیم از میزکار</p></div><Activity size={18} className="app-muted"/></div><LatestShipmentStatuses/></Glass>
    <Glass className="p-5"><div className="flex items-center gap-2 mb-4"><FolderOpen size={17}/><div><h2 className="font-black text-sm">دسترسی سریع</h2><p className="text-[10px] app-muted mt-1">عملیات پرتکرار</p></div></div><div className="space-y-2">{quick.map(([label,to,Icon,tone])=><Link key={to} to={to} className={`flex items-center gap-3 min-h-12 px-3 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-3)] transition ${tone==='primary'?'ring-1 ring-[var(--primary)]/40':''}`}><span className="w-8 h-8 rounded-lg grid place-items-center bg-[var(--surface)]"><Icon size={15}/></span><span className="text-xs font-bold flex-1">{label}</span><ArrowUpLeft size={14} className="app-muted"/></Link>)}</div></Glass>
   </section>
   <RemindersHomeCard/>
  </div>
 </main>;
};