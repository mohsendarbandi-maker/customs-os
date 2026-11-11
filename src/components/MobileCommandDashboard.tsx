import React, { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowUpLeft, Bell, ClipboardList, FileText, FolderOpen, Plus, Settings, Ship, Users, Wallet } from 'lucide-react';

type DashboardStats={shipments:number;clients:number;cases:number;active:number;activeCases:number};
type Props={profileName:string;dateText:string;timeText:string;stats:DashboardStats;shipmentTracker:ReactNode;reminders:ReactNode};
const metrics=[
 {key:'shipments',label:'کل محموله‌ها',to:'/shipment-showcase',Icon:Ship},
 {key:'activeCases',label:'پرونده‌های باز',to:'/cases',Icon:ClipboardList},
 {key:'clients',label:'صاحبان کالا',to:'/clients',Icon:Users},
 {key:'cases',label:'کل پرونده‌ها',to:'/cases',Icon:FileText},
] as const;
const actions=[
 {label:'ثبت محموله',detail:'شروع پرونده جدید',to:'/operations?tab=pre-declaration',Icon:Plus,tone:'primary'},
 {label:'ثبت سفارش',detail:'مدیریت سفارش‌ها',to:'/registration-orders',Icon:ClipboardList,tone:'blue'},
 {label:'مدیریت اسناد',detail:'پرونده و بایگانی',to:'/file-manager',Icon:FolderOpen,tone:'teal'},
 {label:'امور مالی',detail:'هزینه و پرداخت',to:'/finance',Icon:Wallet,tone:'slate'},
] as const;

export const MobileCommandDashboard:React.FC<Props>=({profileName,dateText,timeText,stats,shipmentTracker,reminders})=>(
 <div className="mobile-command-dashboard" dir="rtl">
  <header className="mobile-command-greeting">
   <div className="mobile-command-brand"><span className="mobile-command-brand-mark" aria-hidden="true"><Ship size={21}/></span><span className="mobile-command-brand-copy"><small>DARBANDI · MARITIME OPERATIONS</small><b>میزکار عملیات</b></span></div>
   <Link to="/settings/appearance" className="mobile-command-settings" aria-label="تنظیمات ظاهر"><Settings size={19}/></Link>
  </header>
  <section className="mobile-command-hero" aria-labelledby="mobile-command-title">
   <span className="mobile-command-hero-orbit" aria-hidden="true"/>
   <div className="mobile-command-hero-copy"><span className="mobile-command-eyebrow">OPERATION CONTROL CENTER</span><h1 id="mobile-command-title">سلام، {profileName}</h1><p>{dateText}<span aria-hidden="true"> · </span>{timeText}</p></div>
   <div className="mobile-command-active"><div><span>محموله‌های در جریان</span><strong>{stats.active.toLocaleString('fa-IR')}</strong><small>از {stats.shipments.toLocaleString('fa-IR')} محموله ثبت‌شده</small></div><span className="mobile-command-active-icon" aria-hidden="true"><Activity size={25}/></span></div>
   <div className="mobile-command-hero-footer"><span><i aria-hidden="true"/> نمای عملیاتی بر اساس اطلاعات ثبت‌شده</span><Link to="/shipment-showcase">مشاهده همه <ArrowUpLeft size={14}/></Link></div>
  </section>
  <section className="mobile-command-metrics" aria-label="شاخص‌های عملیاتی">
   {metrics.map(({key,label,to,Icon})=><Link className="mobile-command-metric" to={to} key={key}><span className="mobile-command-metric-icon"><Icon size={17}/></span><span className="mobile-command-metric-copy"><small>{label}</small><strong>{stats[key].toLocaleString('fa-IR')}</strong></span><ArrowUpLeft className="mobile-command-metric-arrow" size={13}/></Link>)}
  </section>
  <section className="mobile-command-actions" aria-labelledby="mobile-command-actions-title">
   <div className="mobile-command-section-heading"><div><span>QUICK ACCESS</span><h2 id="mobile-command-actions-title">دسترسی سریع</h2></div></div>
   <div className="mobile-command-action-grid">{actions.map(({label,detail,to,Icon,tone})=><Link className={`mobile-command-action ${tone}`} to={to} key={to}><span className="mobile-command-action-icon"><Icon size={19}/></span><span className="mobile-command-action-copy"><b>{label}</b><small>{detail}</small></span><ArrowUpLeft size={14} className="mobile-command-action-arrow"/></Link>)}</div>
  </section>
  <section className="mobile-command-shipments" aria-label="وضعیت و پیشرفت واقعی محموله‌ها">{shipmentTracker}</section>
  <section className="mobile-command-reminders" aria-label="یادآورهای عملیاتی">
   <div className="mobile-command-section-heading"><div><span>FOLLOW UPS</span><h2><Bell size={17}/> پیگیری‌های مهم</h2></div><Link to="/reminders">همه یادآورها <ArrowUpLeft size={14}/></Link></div>
   {reminders}
  </section>
 </div>
);
export default MobileCommandDashboard;
