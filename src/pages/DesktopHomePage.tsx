import React,{useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpLeft,Briefcase,CloudSun,FileText,Settings,Ship,Wallet,Waves,Activity,Plus,Clock3,Building2,ChevronLeft,GripVertical,ChevronUp,ChevronDown,Maximize2,RotateCcw} from 'lucide-react';
import {useAuth} from '../context/AuthContext';
import {supabase} from '../lib/supabase';
import {LatestShipmentStatuses} from '../components/LatestShipmentStatuses';
import {RemindersHomeCard} from '../features/reminders/RemindersHomeCard';

const ports=[{name:'انزلی',lat:37.4727,lon:49.4587},{name:'آستارا',lat:38.429,lon:48.875},{name:'امیرآباد',lat:36.925,lon:53.420},{name:'نوشهر',lat:36.648,lon:51.496},{name:'فریدونکنار',lat:36.686,lon:52.523},{name:'ترکمن',lat:36.901,lon:54.071},{name:'بندر گز',lat:36.756,lon:53.947}];
const faDate=new Intl.DateTimeFormat('fa-IR-u-ca-persian',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
const faTime=new Intl.DateTimeFormat('fa-IR',{hour:'2-digit',minute:'2-digit'});
const Glass=({children,className='' }:{children:React.ReactNode;className?:string})=><section className={`border border-[var(--border)] bg-[var(--surface)] rounded-xl ${className}`}>{children}</section>;

type DashboardWidgetId='stats'|'shipments'|'marine'|'shortcuts'|'reminders';
const DASHBOARD_WIDGET_IDS:DashboardWidgetId[]=['stats','shipments','marine','shortcuts','reminders'];
const DEFAULT_WIDGET_SPANS:Record<DashboardWidgetId,number>={stats:12,shipments:12,marine:8,shortcuts:4,reminders:12};
type MotionWidgetProps={
 id:DashboardWidgetId;title:string;editing:boolean;order:number;span:number;
 onMove:(from:DashboardWidgetId,to:DashboardWidgetId)=>void;
 onShift:(id:DashboardWidgetId,delta:number)=>void;
 onResize:(id:DashboardWidgetId)=>void;
 children:React.ReactNode;
};
const MotionWidget:React.FC<MotionWidgetProps>=({id,title,editing,order,span,onMove,onShift,onResize,children})=>{
 const handleDragStart=(event:React.DragEvent<HTMLButtonElement>)=>{
  event.dataTransfer.setData('text/plain',id);
  event.dataTransfer.effectAllowed='move';
  event.currentTarget.closest('.customs-widget-frame')?.classList.add('is-dragging');
 };
 const handleDrop=(event:React.DragEvent<HTMLDivElement>)=>{
  event.preventDefault();
  const from=event.dataTransfer.getData('text/plain') as DashboardWidgetId;
  onMove(from,id);
  event.currentTarget.classList.remove('is-drop-target');
 };
 return <div className={`customs-widget-frame ${editing?'is-editing':''}`} data-customs-widget={id} style={{order,gridColumn:`span ${span}`}}
  onDragOver={event=>{if(editing){event.preventDefault();event.dataTransfer.dropEffect='move';event.currentTarget.classList.add('is-drop-target')}}}
  onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))event.currentTarget.classList.remove('is-drop-target')}}
  onDrop={handleDrop}>
  {editing&&<div className="customs-widget-tools" aria-label={`ابزار چیدمان ${title}`}>
   <button type="button" className="customs-widget-grip" draggable aria-label={`جابجایی ${title}`} title="برای جابه‌جایی بکش" onDragStart={handleDragStart} onDragEnd={event=>event.currentTarget.closest('.customs-widget-frame')?.classList.remove('is-dragging')}><GripVertical size={17}/></button>
   <button type="button" aria-label={`انتقال ${title} به بالا`} title="بالا" onClick={()=>onShift(id,-1)}><ChevronUp size={16}/></button>
   <button type="button" aria-label={`انتقال ${title} به پایین`} title="پایین" onClick={()=>onShift(id,1)}><ChevronDown size={16}/></button>
   <button type="button" aria-label={`تغییر اندازه ${title}`} title="تغییر عرض باکس" onClick={()=>onResize(id)}><Maximize2 size={15}/></button>
  </div>}
  <div className="customs-widget-body">{children}</div>
 </div>;
};

export const DesktopHomePage:React.FC=()=>{
 const{profile}=useAuth();
 const layoutStorageKey=`customs-os:motion-layout:v1:${profile?.organization_id||'unassigned'}:${profile?.id||'unassigned'}`;
 const[widgetOrder,setWidgetOrder]=useState<DashboardWidgetId[]>([...DASHBOARD_WIDGET_IDS]);
 const[widgetSpans,setWidgetSpans]=useState<Record<DashboardWidgetId,number>>({...DEFAULT_WIDGET_SPANS});
 const[layoutLoaded,setLayoutLoaded]=useState(false);
 const[editingLayout,setEditingLayout]=useState(false);
 useEffect(()=>{
  let nextOrder=[...DASHBOARD_WIDGET_IDS];
  let nextSpans={...DEFAULT_WIDGET_SPANS};
  try{
   const raw=localStorage.getItem(layoutStorageKey);
   if(raw){
    const saved=JSON.parse(raw) as {order?:unknown;spans?:Record<string,unknown>};
    if(Array.isArray(saved.order)){
     const known=saved.order.filter((id):id is DashboardWidgetId=>typeof id==='string'&&DASHBOARD_WIDGET_IDS.includes(id as DashboardWidgetId));
     nextOrder=[...known.filter((id,index)=>known.indexOf(id)===index),...DASHBOARD_WIDGET_IDS.filter(id=>!known.includes(id))];
    }
    if(saved.spans&&typeof saved.spans==='object'){
     DASHBOARD_WIDGET_IDS.forEach(id=>{
      const span=saved.spans?.[id];
      if(typeof span==='number'&&[4,6,8,12].includes(span))nextSpans[id]=span;
     });
    }
   }
  }catch{}
  setWidgetOrder(nextOrder);
  setWidgetSpans(nextSpans);
  setLayoutLoaded(true);
 },[layoutStorageKey]);
 useEffect(()=>{
  if(!layoutLoaded)return;
  try{localStorage.setItem(layoutStorageKey,JSON.stringify({order:widgetOrder,spans:widgetSpans}))}catch{}
 },[layoutStorageKey,layoutLoaded,widgetOrder,widgetSpans]);
 const moveWidget=(from:DashboardWidgetId,to:DashboardWidgetId)=>{
  if(!DASHBOARD_WIDGET_IDS.includes(from)||!DASHBOARD_WIDGET_IDS.includes(to)||from===to)return;
  setWidgetOrder(current=>{const next=current.filter(id=>id!==from);const target=next.indexOf(to);next.splice(target<0?next.length:target,0,from);return next});
 };
 const shiftWidget=(id:DashboardWidgetId,delta:number)=>{
  setWidgetOrder(current=>{const from=current.indexOf(id);const to=Math.max(0,Math.min(current.length-1,from+delta));if(from<0||from===to)return current;const next=[...current];next.splice(from,1);next.splice(to,0,id);return next});
 };
 const resizeWidget=(id:DashboardWidgetId)=>{
  setWidgetSpans(current=>{const options=[12,8,6,4];const index=options.indexOf(current[id]);return {...current,[id]:options[(index+1)%options.length]}})
 };
 const resetWidgetLayout=()=>{setWidgetOrder([...DASHBOARD_WIDGET_IDS]);setWidgetSpans({...DEFAULT_WIDGET_SPANS})};
 const[now,setNow]=useState(new Date()),[port,setPort]=useState(ports[0]),[weather,setWeather]=useState<any>(null),[marine,setMarine]=useState<any>(null),[conditionsError,setConditionsError]=useState(false),[conditionsUpdated,setConditionsUpdated]=useState(''),[stats,setStats]=useState({shipments:0,clients:0,cases:0,active:0,activeCases:0});
 useEffect(()=>{const id=window.setInterval(()=>setNow(new Date()),1000);return()=>window.clearInterval(id)},[]);
 useEffect(()=>{let cancelled=false;setWeather(null);setMarine(null);setConditionsError(false);fetch(`/api/maritime/conditions?latitude=${port.lat}&longitude=${port.lon}`,{headers:{Accept:'application/json'},cache:'no-store',credentials:'same-origin'}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j?.error||'conditions unavailable');if(cancelled)return;setWeather(j.weather?.current||null);setMarine(j.marine?.current||null);setConditionsUpdated(j.updated_at||'');setConditionsError(!j.weather?.current&&!j.marine?.current)}).catch(()=>{if(!cancelled){setWeather(null);setMarine(null);setConditionsError(true)}});return()=>{cancelled=true}},[port]);
 useEffect(()=>{let cancelled=false;(async()=>{const[sh,cl,cs]=await Promise.all([supabase.from('shipments').select('id,current_status'),supabase.from('clients').select('id'),supabase.from('cases').select('id,status')]);if(cancelled)return;const shipments=sh.data||[],cases=cs.data||[];setStats({shipments:shipments.length,clients:(cl.data||[]).length,cases:cases.length,active:shipments.filter((x:any)=>!['cleared','archived','closed'].includes(String(x.current_status||'').toLowerCase())).length,activeCases:cases.filter((x:any)=>!['closed','archived','completed','cancelled'].includes(String(x.status||'').toLowerCase())).length})})().catch(()=>{});return()=>{cancelled=true}},[]);
 const weatherText=useMemo(()=>{const c=weather?.weather_code;if(c===0)return'صاف';if([1,2,3].includes(c))return'نیمه‌ابری';if([45,48].includes(c))return'مه';if([51,53,55,61,63,65,80,81,82].includes(c))return'بارش';if([95,96,99].includes(c))return'رعدوبرق';return'—'},[weather]);
 return <main dir="rtl" className="customs-home min-h-screen text-[var(--text)]" style={{background:'var(--bg)'}}>
  <div className="w-full mx-auto px-4 sm:px-6 xl:px-8 py-5 lg:py-7">
   <header className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-5 border-b border-[var(--border)]">
    <div className="flex items-center gap-3"><div className="customs-home-mark"><Ship size={24}/><span/></div><div><div className="customs-home-tagline text-[10px] font-bold tracking-[.08em] text-[var(--primary)] mb-1">CUSTOMS & LOGISTICS MANAGEMENT</div><h1 className="text-xl lg:text-2xl font-black tracking-tight">میزکار عملیاتی</h1><p className="text-xs app-muted mt-1">{faDate.format(now)}<span className="mx-1 opacity-40">،</span>{faTime.format(now)}</p></div></div>
    <div className="flex items-center gap-2"><Link to="/settings" className="customs-line-button" aria-label="تنظیمات"><Settings size={17}/><span className="hidden sm:inline">تنظیمات</span></Link><Link to="/operations?tab=pre-declaration" className="customs-primary-button"><Plus size={16}/>ثبت محموله</Link></div>
   </header>
   <div className="customs-widget-toolbar">
    <div className="customs-widget-toolbar-copy"><Activity size={16}/><span>{editingLayout?'چیدمان را ویرایش کن؛ باکس‌ها را بکش یا از فلش‌ها استفاده کن.':'میزکار شخصی‌سازی‌پذیر · چیدمان باکس‌ها فقط برای حساب شما ذخیره می‌شود.'}</span></div>
    <div className="customs-widget-toolbar-actions">
     {editingLayout&&<button type="button" className="customs-layout-action" onClick={resetWidgetLayout}><RotateCcw size={14}/>بازنشانی چیدمان</button>}
     <button type="button" className={`customs-layout-action ${editingLayout?'is-primary':''}`} onClick={()=>setEditingLayout(value=>!value)}><GripVertical size={14}/>{editingLayout?'پایان ویرایش':'ویرایش چیدمان'}</button>
    </div>
   </div>
   <div className="customs-widget-grid" data-customs-dashboard>
   <MotionWidget id="stats" title="نمای کلی سازمان" editing={editingLayout} order={widgetOrder.indexOf('stats')} span={widgetSpans.stats} onMove={moveWidget} onShift={shiftWidget} onResize={resizeWidget}>
   <section className="customs-stat-line" aria-label="نمای کلی سازمان">
    {[{label:'کل محموله‌ها',value:stats.shipments,icon:Ship,to:'/operations'},{label:'در جریان عملیات',value:stats.active,icon:Activity,to:'/operations'},{label:'پرونده‌های صاحبان کالا',value:stats.clients,icon:Building2,to:'/clients'},{label:'پرونده‌های در جریان',value:stats.activeCases,icon:Briefcase,to:'/cases'}].map(({label,value,icon:Icon,to},i)=><React.Fragment key={label}><Link to={to} className="customs-stat" aria-label={label}><Icon size={17} className="text-[var(--primary)]"/><span className="text-xs app-muted">{label}</span><strong>{value}</strong></Link>{i<3&&<span className="customs-stat-divider"/>}</React.Fragment>)}
   </section>
   </MotionWidget>
   <MotionWidget id="shipments" title="وضعیت محموله‌ها" editing={editingLayout} order={widgetOrder.indexOf('shipments')} span={widgetSpans.shipments} onMove={moveWidget} onShift={shiftWidget} onResize={resizeWidget}>
   <section className="customs-shipments-section">
    <div className="customs-status-board"><LatestShipmentStatuses/></div>
   </section>
   </MotionWidget>
   <MotionWidget id="marine" title="آب‌وهوا و وضعیت دریایی" editing={editingLayout} order={widgetOrder.indexOf('marine')} span={widgetSpans.marine} onMove={moveWidget} onShift={shiftWidget} onResize={resizeWidget}>
    <Glass className="p-4 lg:p-5"><div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div><div className="text-[10px] tracking-widest text-[var(--primary)] font-bold mb-1">PORT & MARINE CONDITIONS</div><h2 className="font-black">آب‌وهوا و وضعیت دریایی</h2></div><Link to="/marine-conditions" className="customs-line-button text-xs"><Waves size={15}/>جزئیات دریا، AIS و لنگرگاه<ArrowUpLeft size={13}/></Link></div><div className="flex flex-wrap items-center justify-between gap-4"><div><select aria-label="انتخاب بندر برای وضعیت هوا و دریا" value={port.name} onChange={e=>setPort(ports.find(p=>p.name===e.target.value)||ports[0])} className="bg-transparent border-b border-[var(--border)] pb-2 text-sm font-bold outline-none"><option className="text-slate-900" value={port.name}>{port.name}</option>{ports.filter(p=>p.name!==port.name).map(p=><option className="text-slate-900" key={p.name} value={p.name}>{p.name}</option>)}</select><div className="flex items-baseline gap-2 mt-3"><CloudSun size={20} className="app-muted"/><span className="text-3xl font-black">{weather?.temperature_2m!=null?Math.round(weather.temperature_2m):'—'}°</span><span className="text-xs app-muted">{weatherText}</span></div><div className="text-[10px] app-muted mt-1">{conditionsError?'داده‌های هواشناسی موقتاً پاسخ نمی‌دهند.':weather?.apparent_temperature!=null?'دمای محسوس: '+Math.round(weather.apparent_temperature)+'°':''}</div></div><div className="grid grid-cols-2 gap-2 text-xs min-w-[175px]"><div className="rounded-xl bg-[var(--surface-2)] p-3"><span className="app-muted">باد</span><b className="block mt-1">{weather?.wind_speed_10m??'—'} km/h</b></div><div className="rounded-xl bg-[var(--surface-2)] p-3"><span className="app-muted">تندباد</span><b className="block mt-1">{weather?.wind_gusts_10m??'—'} km/h</b></div></div></div><div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4"><div className="rounded-xl border app-border p-3"><span className="text-[10px] app-muted">ارتفاع موج</span><b className="block mt-1 text-lg">{marine?.wave_height??'—'} m</b></div><div className="rounded-xl border app-border p-3"><span className="text-[10px] app-muted">دوره موج</span><b className="block mt-1 text-lg">{marine?.wave_period??'—'} s</b></div><div className="rounded-xl border app-border p-3"><span className="text-[10px] app-muted">دمای سطح آب</span><b className="block mt-1 text-lg">{marine?.sea_surface_temperature??'—'}°</b></div><div className="rounded-xl border app-border p-3"><span className="text-[10px] app-muted">جریان مدل آب</span><b className="block mt-1 text-lg">{marine?.ocean_current_velocity??'—'} km/h</b></div></div><div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-[10px] app-muted"><span>{conditionsUpdated?'آخرین دریافت: '+new Date(conditionsUpdated).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'}):'داده‌ها پس از دریافت نمایش داده می‌شوند.'}</span><span>منبع داده: Open-Meteo · به‌روزرسانی از مسیر Cloudflare</span></div></Glass>
   </MotionWidget>
   <MotionWidget id="shortcuts" title="دسترسی‌های پرکاربرد" editing={editingLayout} order={widgetOrder.indexOf('shortcuts')} span={widgetSpans.shortcuts} onMove={moveWidget} onShift={shiftWidget} onResize={resizeWidget}>
    <Glass className="p-4 lg:p-5"><div className="flex items-center gap-2 mb-3"><Clock3 size={17} className="text-[var(--primary)]"/><h2 className="font-black">دسترسی‌های پرکاربرد</h2></div><div className="grid grid-cols-2 lg:grid-cols-1 gap-2">{[{label:'عملیات پرونده',to:'/operations',icon:Briefcase},{label:'اسناد',to:'/documents',icon:FileText},{label:'امور مالی',to:'/finance',icon:Wallet},{label:'یادآورها',to:'/reminders',icon:Clock3}].map(({label,to,icon:Icon})=><Link key={to} to={to} className="customs-shortcut"><Icon size={16}/><span>{label}</span><ArrowUpLeft size={13} className="mr-auto opacity-50"/></Link>)}</div></Glass>
   </MotionWidget>
   <MotionWidget id="reminders" title="یادآورها" editing={editingLayout} order={widgetOrder.indexOf('reminders')} span={widgetSpans.reminders} onMove={moveWidget} onShift={shiftWidget} onResize={resizeWidget}>
    <div className="mt-0"><RemindersHomeCard/></div>
   </MotionWidget>
   </div>
  </div>
 </main>;
};
