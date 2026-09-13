import React from 'react';
import {Anchor,ArrowLeft,Building2,Calculator,FileCheck2,FileText,History,LayoutDashboard,Printer,ShieldCheck,Truck,Wallet,Activity,ListChecks,Ship} from 'lucide-react';
import {Link} from 'react-router-dom';

type CardProps={to:string;icon:any;title:string;en:string;desc:string};
const Card=({to,icon:Icon,title,en,desc}:CardProps)=><Link to={to} className="group block bg-slate-900 border border-slate-800 hover:border-blue-500 rounded-2xl p-5 transition duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-cyan-400"><div className="flex items-start justify-between gap-3"><div className="h-11 w-11 rounded-xl bg-blue-500/10 grid place-items-center"><Icon className="text-blue-400" size={23}/></div><ArrowLeft className="text-slate-600 group-hover:text-blue-400 transition" size={17}/></div><h2 className="font-black text-base mt-5">{title}</h2><div className="text-[10px] text-slate-500 mt-1">{en}</div><p className="text-sm text-slate-400 mt-3 leading-6 min-h-[48px]">{desc}</p></Link>;

const sections=[
 {title:'هسته عملیات',en:'Core Operations',items:[
  {to:'/control',icon:Activity,title:'مرکز کنترل',en:'Operations Control Center',desc:'نمای یکپارچه وضعیت پرونده‌ها، محموله‌ها، مجوزها، مالی و خروج کالا.'},
  {to:'/operations',icon:LayoutDashboard,title:'عملیات پرونده',en:'Customs Operations',desc:'ایجاد و مدیریت پرونده و اجرای چرخه اصلی عملیات ترخیص.'},
  {to:'/stage',icon:ListChecks,title:'کنترل مراحل',en:'Case Stage Control',desc:'کنترل مرحله‌ای پرونده با بررسی پیش‌نیازهای واقعی در دیتابیس.'}
 ]},
 {title:'حمل و پرونده',en:'Cargo & Case Data',items:[
  {to:'/clients',icon:Building2,title:'صاحب کالا',en:'Cargo Owner Registry',desc:'مدیریت اطلاعات صاحبان کالا و اتصال امن اطلاعات EPL به هر صاحب کالا.'},
  {to:'/maritime',icon:Anchor,title:'کشتیرانی',en:'Maritime Shipment',desc:'مدیریت B/L، کشتی، IMO، Voyage، وزن، بارشماری، ترخیصیه و رهگیری.'},
  {to:'/operations?tab=registration',icon:FileText,title:'ثبت سفارش',en:'Registration Orders',desc:'ثبت سفارش مستقل و اتصال آن به پرونده در زمان مناسب.'}
 ]},
 {title:'ترخیص',en:'Customs Clearance',items:[
  {to:'/operations?tab=declaration',icon:FileCheck2,title:'اظهار و EPL',en:'Declaration / EPL',desc:'مدیریت اظهار، کوتاژ و مسیرهای سبز، زرد و قرمز.'},
  {to:'/operations?tab=valuation',icon:Calculator,title:'ارزش‌گذاری',en:'Valuation & Duties',desc:'محاسبه و کنترل ارزش گمرکی، حقوق ورودی و مبالغ پرداختی.'},
  {to:'/operations?tab=documents',icon:FileText,title:'اسناد و مجوزها',en:'Documents & Permits',desc:'مدیریت اسناد پرونده و مجوزهای موردنیاز مستقل از Route.'},
  {to:'/permit-rules',icon:ShieldCheck,title:'قواعد مجوز',en:'Permit Rules Engine',desc:'مدیریت قواعد قابل تنظیم بر اساس HS و ماهیت کالا.'}
 ]},
 {title:'مالی، خروج و کنترل',en:'Finance, Exit & Control',items:[
  {to:'/finance',icon:Wallet,title:'مالی پرونده',en:'Case Finance Ledger',desc:'ثبت هزینه، درآمد، سپرده و برداشت و جمع‌بندی ریالی پرونده.'},
  {to:'/exit',icon:Truck,title:'خروج کالا',en:'Cargo Exit',desc:'مجوز خروج، مشخصات خودرو و راننده و ثبت خروج نهایی کالا.'},
  {to:'/history',icon:History,title:'تاریخچه و Audit',en:'Case History & Audit',desc:'مشاهده تاریخچه مرحله‌ها، رویدادها و سوابق Audit پرونده.'},
  {to:'/print-declaration',icon:Printer,title:'چاپ اطلاعات اظهار',en:'Declaration Handoff Print',desc:'چاپ برگه عملیاتی اطلاعات پرونده بدون نمایش اطلاعات حساس.'}
 ]}
];

export const MainMenuPage:React.FC=()=> <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8" dir="rtl"><div className="max-w-[1720px] mx-auto"><header className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-7 lg:p-8 mb-7"><div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5"><div><div className="flex items-center gap-3"><span className="app-brand-mark"><Ship size={24}/></span><div><div className="text-xs text-slate-500">Enterprise Customs & Logistics Platform</div><h1 className="text-2xl sm:text-3xl font-black tracking-tight">Customs OS</h1></div></div><p className="mt-4 text-sm sm:text-base text-slate-400 max-w-4xl leading-7">سامانه مدیریت عملیات گمرکی و لجستیک؛ از حمل و کشتیرانی و ثبت سفارش تا اظهار، ارزش‌گذاری، مجوز، مالی و خروج کالا.</p></div><Link to="/control" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-5 py-3 text-sm font-bold shadow-lg shadow-blue-900/20">ورود به مرکز کنترل <ArrowLeft size={16}/></Link></div></header>{sections.map(section=><section key={section.title} className="mb-8"><div className="flex items-end justify-between gap-4 mb-3"><div><h2 className="font-black text-lg">{section.title}</h2><div className="text-[10px] text-slate-500 mt-1">{section.en}</div></div><span className="text-xs text-slate-600">{section.items.length} ماژول</span></div><div className="grid sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">{section.items.map(item=><Card key={item.to} {...item}/>)}</div></section>)}</div></main>;
