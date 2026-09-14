import React,{useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {Anchor,Archive,BriefcaseBusiness,Calculator,CloudSun,Clock3,Database,FileCheck2,FileSearch,FolderKanban,HardDrive,MapPinned,Menu,PackageSearch,RefreshCw,Settings,Ship,Truck,Wallet,Wifi,Wind} from 'lucide-react';

const cities=[
 {name:'تهران',lat:35.6892,lon:51.3890},
 {name:'بندرعباس',lat:27.1832,lon:56.2666},
 {name:'بندر انزلی',lat:37.4727,lon:49.4587},
 {name:'باکو',lat:40.4093,lon:49.8671},
];
const apps=[
 ['control','مرکز کنترل','/control',FolderKanban],['operations','عملیات گمرکی','/operations',BriefcaseBusiness],['maritime','کشتیرانی و B/L','/maritime',Anchor],['vessel','موقعیت کشتی','/vessel-tracking',MapPinned],['clients','صاحبان کالا','/clients',Database],['finance','مالی','/finance',Wallet],['exit','خروج و ترانزیت','/exit',Truck],['permits','مجوزها','/permit-rules',FileCheck2],['documents','استخراج اسناد','/documents/extract',FileSearch],['history','سوابق پرونده','/history',Archive],['stage','مرحله پرونده','/stage',PackageSearch],['print','چاپ اظهار','/print-declaration',Calculator],
] as const;

const faDate=new Intl.DateTimeFormat('fa-IR-u-ca-persian',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
const faTime=new Intl.DateTimeFormat('fa-IR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});

export const DesktopHomePage:React.FC=()=>{
 const [now,setNow]=useState(new Date());
 const [city,setCity]=useState(cities[0]);
 const [weather,setWeather]=useState<any>(null);
 const [weatherBusy,setWeatherBusy]=useState(false);
 const [weatherError,setWeatherError]=useState('');
 const loadWeather=async()=>{setWeatherBusy(true);setWeatherError('');try{const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`);if(!r.ok)throw new Error('weather');const j=await r.json();setWeather(j.current)}catch{setWeatherError('آب‌وهوا در دسترس نیست')}finally{setWeatherBusy(false)}};
 useEffect(()=>{const id=window.setInterval(()=>setNow(new Date()),1000);return()=>window.clearInterval(id)},[]);
 useEffect(()=>{loadWeather()},[city]);
 const weatherText=useMemo(()=>{const c=weather?.weather_code;if(c===0)return'صاف';if([1,2,3].includes(c))return'نیمه‌ابری';if([45,48].includes(c))return'مه';if([51,53,55,56,57].includes(c))return'نم‌نم';if([61,63,65,66,67].includes(c))return'بارانی';if([71,73,75,77].includes(c))return'برفی';if([80,81,82].includes(c))return'رگباری';if([95,96,99].includes(c))return'رعدوبرق';return'—'},[weather]);
 return <main dir="rtl" className="min-h-screen bg-[#07111f] text-slate-100 overflow-hidden select-none">
  <div className="min-h-screen relative bg-[radial-gradient(circle_at_20%_10%,rgba(14,116,144,.22),transparent_32%),radial-gradient(circle_at_85%_80%,rgba(30,64,175,.20),transparent_35%)]">
   <header className="h-16 px-5 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl flex items-center justify-between">
    <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl bg-cyan-600/90 flex items-center justify-center shadow-lg"><Ship size={21}/></div><div><div className="font-black tracking-wide">Customs OS</div><div className="text-[10px] text-cyan-300/80">Customs & Logistics Operating System</div></div></div>
    <div className="hidden md:flex items-center gap-6 text-xs text-slate-400"><span className="flex items-center gap-1.5"><Wifi size={14}/> Online</span><span className="flex items-center gap-1.5"><HardDrive size={14}/> Operations</span><Link to="/control" className="px-3 py-2 rounded-xl bg-cyan-500/10 border border-cyan-400/20 text-cyan-300">مرکز کنترل</Link></div>
    <Link to="/" className="p-2 rounded-xl hover:bg-white/5" title="Desktop"><Menu size={19}/></Link>
   </header>

   <div className="p-5 md:p-7 lg:p-9 max-w-[1700px] mx-auto">
    <section className="grid lg:grid-cols-[1.4fr_.8fr] gap-5 mb-6">
     <div className="rounded-3xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-6 md:p-8 min-h-[210px] flex flex-col justify-between">
      <div><div className="text-xs text-cyan-300/80 mb-3">CUSTOMS OS DESKTOP</div><h1 className="text-3xl md:text-5xl font-black leading-tight">میز کار عملیات گمرکی</h1><p className="text-sm text-slate-400 mt-3 max-w-2xl">پرونده‌ها، محموله‌ها، B/L، ترانزیت، مالی، مجوزها و موقعیت کشتی‌ها از یک محیط کاری واحد.</p></div>
      <div className="flex flex-wrap gap-2 mt-6"><Link to="/control" className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 font-bold text-sm">ورود به مرکز کنترل</Link><Link to="/operations" className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 font-bold text-sm">ادامه عملیات</Link></div>
     </div>
     <div className="rounded-3xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-6 flex flex-col justify-between">
      <div className="flex items-start justify-between"><div><div className="text-xs text-slate-500">امروز</div><div className="text-3xl font-black mt-1 tabular-nums">{faTime.format(now)}</div></div><Clock3 className="text-cyan-300" size={24}/></div>
      <div className="text-sm text-slate-300 mt-5">{faDate.format(now)}</div><div className="text-xs text-slate-500 mt-1">ساعت سیستم محلی دستگاه</div>
     </div>
    </section>

    <section className="grid xl:grid-cols-[1.55fr_.8fr] gap-5">
     <div className="rounded-3xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-5 md:p-6"><div className="flex items-center justify-between mb-5"><div><h2 className="font-black text-lg">برنامه‌های Customs OS</h2><p className="text-xs text-slate-500 mt-1">مثل دسکتاپ؛ هر بخش یک ابزار مستقل عملیاتی.</p></div><Settings size={18} className="text-slate-500"/></div><div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">{apps.map(([key,label,to,Icon])=><Link key={key} to={to} className="group rounded-2xl border border-white/5 bg-slate-950/50 hover:bg-cyan-500/10 hover:border-cyan-400/20 p-4 min-h-[105px] flex flex-col items-center justify-center text-center transition"><div className="w-11 h-11 rounded-2xl bg-slate-800 group-hover:bg-cyan-500/15 flex items-center justify-center mb-2"><Icon size={20} className="text-cyan-300"/></div><span className="text-xs font-bold leading-5">{label}</span></Link>)}</div></div>

     <div className="rounded-3xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-5 md:p-6"><div className="flex items-center justify-between mb-4"><div><h2 className="font-black">آب‌وهوا</h2><p className="text-xs text-slate-500 mt-1">داده زنده Open-Meteo؛ بدون API Key</p></div><CloudSun className="text-amber-300" size={22}/></div><select value={city.name} onChange={e=>setCity(cities.find(x=>x.name===e.target.value)||cities[0])} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm mb-5">{cities.map(c=><option key={c.name}>{c.name}</option>)}</select>{weatherBusy?<div className="h-32 flex items-center justify-center text-sm text-slate-500"><RefreshCw className="animate-spin ml-2" size={16}/> در حال دریافت...</div>:weatherError?<div className="h-32 flex items-center justify-center text-sm text-amber-300">{weatherError}</div>:<div><div className="flex items-end gap-3"><div className="text-5xl font-black tabular-nums">{weather?.temperature_2m!=null?Math.round(weather.temperature_2m):'—'}°</div><div className="text-sm text-slate-400 pb-2">{weatherText}</div></div><div className="grid grid-cols-2 gap-2 mt-5 text-xs"><div className="rounded-xl bg-slate-950/70 p-3"><Wind size={14} className="inline ml-1 text-cyan-300"/> باد {weather?.wind_speed_10m??'—'} km/h</div><div className="rounded-xl bg-slate-950/70 p-3">رطوبت {weather?.relative_humidity_2m??'—'}%</div></div></div>}</div>
    </section>

    <section className="mt-5 grid md:grid-cols-3 gap-4"><Link to="/vessel-tracking" className="rounded-2xl border border-cyan-400/15 bg-cyan-500/5 p-5 hover:bg-cyan-500/10"><MapPinned className="text-cyan-300 mb-3"/><b>موقعیت کشتی</b><p className="text-xs text-slate-500 mt-1">نمایش مختصات AIS ذخیره‌شده و نقشه بدون iframe سرویس خارجی.</p></Link><Link to="/control" className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 hover:bg-white/5"><FolderKanban className="text-violet-300 mb-3"/><b>مرکز کنترل عملیات</b><p className="text-xs text-slate-500 mt-1">پرونده باز، مجوز، خروج، مالی و Reminder.</p></Link><Link to="/maritime" className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 hover:bg-white/5"><Anchor className="text-cyan-300 mb-3"/><b>Master Data کشتیرانی</b><p className="text-xs text-slate-500 mt-1">کشتی، IMO، B/L، کشتیرانی و وضعیت عملیاتی.</p></Link></section>
   </div>
   <footer className="fixed bottom-0 inset-x-0 h-11 border-t border-white/10 bg-slate-950/85 backdrop-blur-xl px-5 flex items-center justify-between text-[11px] text-slate-500"><span>Customs OS · Operations Desktop</span><span>{faTime.format(now)} · {city.name}</span></footer>
  </div>
 </main>;
};
