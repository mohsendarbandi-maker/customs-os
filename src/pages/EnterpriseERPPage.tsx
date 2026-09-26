import React,{useEffect,useMemo,useState}from'react';
import{ArrowLeft,BarChart3,BookOpen,Building2,Calculator,ChevronLeft,CircleDollarSign,ClipboardCheck,FileText,Landmark,PackageSearch,Receipt,Search,Ship,WalletCards}from'lucide-react';
import{Link}from'react-router-dom';
import{supabase}from'../lib/supabase';
import{useAuth}from'../context/AuthContext';

type Module={title:string;subtitle:string;to:string;icon:React.ElementType;group:string;status:'live'|'foundation'};
const modules:Module[]=[
 {title:'مالی و خزانه',subtitle:'فاکتور، دریافت، پرداخت، تنخواه و درخواست وجه',to:'/finance',icon:WalletCards,group:'مالی',status:'live'},
 {title:'حسابداری',subtitle:'دفتر کل، حساب‌ها، اسناد حسابداری و گزارش‌های مالی',to:'/finance',icon:Calculator,group:'مالی',status:'foundation'},
 {title:'مشتریان و صاحبان کالا',subtitle:'پروفایل طرف حساب و اسناد مرتبط',to:'/clients',icon:Building2,group:'اشخاص',status:'live'},
 {title:'اسناد هوشمند',subtitle:'مدیریت، OCR، استخراج و ارتباط با محموله',to:'/documents',icon:FileText,group:'اسناد',status:'live'},
 {title:'کشتیرانی',subtitle:'کشتی، سفر، بارنامه و اطلاعات حمل',to:'/maritime',icon:Ship,group:'عملیات',status:'live'},
 {title:'کنترل عملیات',subtitle:'نمایش وضعیت عملیات بدون تغییر در هسته عملیاتی',to:'/operations',icon:PackageSearch,group:'عملیات',status:'live'},
 {title:'گزارش‌های مدیریتی',subtitle:'KPI، درآمد، هزینه و سودآوری',to:'/finance',icon:BarChart3,group:'گزارش',status:'foundation'},
 {title:'کنترل اسناد مالی',subtitle:'اسناد مالی متصل به طرف حساب و عملیات',to:'/documents',icon:Receipt,group:'اسناد',status:'foundation'},
];

const money=(n:number)=>new Intl.NumberFormat('fa-IR').format(Math.round(n||0));

export const EnterpriseERPPage:React.FC=()=>{const{profile}=useAuth();const[search,setSearch]=useState('');const[stats,setStats]=useState({shipments:0,clients:0,invoices:0,payments:0});
 useEffect(()=>{let alive=true;(async()=>{const[s,c,i,p]=await Promise.all([supabase.from('shipments').select('id',{count:'exact',head:true}),supabase.from('clients').select('id',{count:'exact',head:true}),supabase.from('finance_invoices').select('id',{count:'exact',head:true}),supabase.from('finance_payments').select('id',{count:'exact',head:true})]);if(alive)setStats({shipments:s.count||0,clients:c.count||0,invoices:i.count||0,payments:p.count||0})})();return()=>{alive=false}},[]);
 const filtered=useMemo(()=>modules.filter(m=>!search||`${m.title} ${m.subtitle} ${m.group}`.includes(search.trim())),[search]);
 return <div className="space-y-6" dir="rtl">
  <section className="rounded-3xl border app-border bg-[var(--surface)]/80 backdrop-blur-xl p-5 md:p-7">
   <div className="flex flex-col lg:flex-row lg:items-center gap-5 justify-between">
    <div><div className="text-xs app-muted mb-2">Enterprise Logistics ERP</div><h1 className="text-2xl md:text-3xl font-black">مرکز مدیریت سازمان</h1><p className="app-muted mt-2 max-w-2xl">لایه مدیریتی یکپارچه برای عملیات، اسناد، مالی و حسابداری؛ بدون تغییر در هسته فعلی عملیات، پرونده و محموله.</p></div>
    <div className="flex items-center gap-2"><Link to="/finance" className="rounded-2xl px-4 py-3 bg-[var(--primary)] text-white text-sm font-bold">ورود به مالی</Link><Link to="/settings" className="rounded-2xl px-4 py-3 border app-border text-sm font-bold">تنظیمات سازمان</Link></div>
   </div>
  </section>
  <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
   {[['محموله‌ها',stats.shipments,PackageSearch],['صاحبان کالا',stats.clients,Building2],['صورتحساب‌ها',stats.invoices,Receipt],['پرداخت‌ها',stats.payments,Landmark]].map(([label,value,Icon]:any)=><div key={label} className="rounded-2xl border app-border bg-[var(--surface)]/70 p-4"><Icon size={18} className="app-muted"/><div className="text-2xl font-black mt-3">{money(value)}</div><div className="text-xs app-muted mt-1">{label}</div></div>)}
  </section>
  <section className="rounded-3xl border app-border bg-[var(--surface)]/70 overflow-hidden">
   <div className="p-4 border-b app-border flex flex-col sm:flex-row gap-3 sm:items-center justify-between"><div><h2 className="font-black">ماژول‌های ERP</h2><p className="text-xs app-muted mt-1">ماژول‌های موجود و لایه‌های در حال توسعه</p></div><div className="relative"><Search size={16} className="absolute right-3 top-3 app-muted"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="جستجوی ماژول..." className="pr-9 pl-3 py-2 rounded-xl border app-border bg-transparent text-sm outline-none w-full sm:w-64"/></div></div>
   <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">{filtered.map(m=>{const Icon=m.icon;return <Link key={m.title} to={m.to} className="group rounded-2xl border app-border p-4 hover:border-[var(--primary)] transition-colors"><div className="flex items-start justify-between gap-3"><span className="h-10 w-10 rounded-xl grid place-items-center bg-[var(--primary)]/10 text-[var(--primary)]"><Icon size={20}/></span><span className={`text-[10px] px-2 py-1 rounded-full ${m.status==='live'?'bg-emerald-500/10 text-emerald-600':'bg-amber-500/10 text-amber-600'}`}>{m.status==='live'?'فعال':'لایه معماری'}</span></div><h3 className="font-black mt-4">{m.title}</h3><p className="text-xs app-muted mt-1 leading-5">{m.subtitle}</p><div className="flex items-center gap-1 text-xs text-[var(--primary)] mt-4">باز کردن <ArrowLeft size={14}/></div></Link>})}</div>
  </section>
  <section className="grid lg:grid-cols-3 gap-3">
   <div className="rounded-2xl border app-border p-4"><div className="flex items-center gap-2 font-bold"><CircleDollarSign size={18}/> زنجیره مالی</div><div className="text-xs app-muted leading-6 mt-3">طرف حساب → صورتحساب → دریافت/پرداخت → تسویه → سودآوری محموله → حسابداری</div></div>
   <div className="rounded-2xl border app-border p-4"><div className="flex items-center gap-2 font-bold"><ClipboardCheck size={18}/> کنترل دسترسی</div><div className="text-xs app-muted leading-6 mt-3">دسترسی‌ها بر اساس سازمان، شعبه، نقش و موجودیت نگهداری می‌شوند. کاربر فعلی: {profile?.full_name||'—'}</div></div>
   <div className="rounded-2xl border app-border p-4"><div className="flex items-center gap-2 font-bold"><BookOpen size={18}/> اصل معماری</div><div className="text-xs app-muted leading-6 mt-3">Operations، Case و Shipment منبع حقیقت باقی می‌مانند و ERP از طریق ارتباطات افزایشی به آن‌ها متصل می‌شود.</div></div>
  </section>
 </div>}
