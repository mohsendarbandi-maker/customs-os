import React,{useEffect,useState} from 'react';
import {ArrowRight,CheckCircle2,RotateCcw} from 'lucide-react';
import {Link} from 'react-router-dom';

const items=['در انتظار مبلغ ترخیصیه','پاس کشتی','اظهار','مالیات علی الحساب','درخواست ضمانتنامه حقوق ورودی و ارزش افزوده','ارزیابی','آزمایشگاه','مجوز استاندارد','نوبت کارشناسی','کد ساتا','تبصره دو منطقه آزاد','صورت‌حساب انبارداری اولیه','صورت‌حساب انبارداری متمم','وکالت حمل'];
const KEY='customs_os_declaration_checklist';
const nav=(tab:string)=>`/operations?tab=${tab}`;
export const DeclarationChecklistPage:React.FC=()=>{
 const[checked,setChecked]=useState<boolean[]>(()=>{try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');return items.map((_,i)=>Boolean(x?.[i]))}catch{return items.map(()=>false)}});
 const toggle=(i:number)=>setChecked(p=>{const n=p.map((v,j)=>j===i?!v:v);try{localStorage.setItem(KEY,JSON.stringify(n))}catch{}return n});
 const reset=()=>{const n=items.map(()=>false);setChecked(n);try{localStorage.setItem(KEY,JSON.stringify(n))}catch{}};
 const done=checked.filter(Boolean).length;
 useEffect(()=>{try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(x))setChecked(items.map((_,i)=>Boolean(x[i])))}catch{}},[]);
 return <main dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8"><div className="max-w-5xl mx-auto space-y-5"><header><div className="text-xs text-slate-500">CUSTOMS / DECLARATION / EPL</div><h1 className="text-2xl font-black mt-1">۲- اظهار / EPL</h1></header><nav className="grid grid-cols-1 md:grid-cols-3 gap-2"><Link to={nav('pre-declaration')} className="rounded-xl px-4 py-3 text-center font-bold bg-slate-900 border border-slate-700">۱. ورود اطلاعات قبل اظهار</Link><Link to={nav('declaration')} className="rounded-xl px-4 py-3 text-center font-bold bg-blue-600">۲. اظهار / EPL</Link><Link to={nav('exit')} className="rounded-xl px-4 py-3 text-center font-bold bg-slate-900 border border-slate-700">۳. صدور پروانه / درب خروج</Link></nav><section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><div className="flex items-center justify-between mb-4"><div><h2 className="font-bold text-lg">چک‌لیست اظهار</h2><p className="text-xs text-slate-500 mt-1">{done} از {items.length} مورد انجام شده</p></div><button onClick={reset} className="px-3 py-2 rounded-xl border border-slate-700 text-sm"><RotateCcw className="inline ml-1" size={15}/> پاک کردن</button></div><div className="space-y-2">{items.map((item,i)=><button key={item} onClick={()=>toggle(i)} className={`w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-right transition ${checked[i]?'border-emerald-700 bg-emerald-950/30':'border-slate-800 bg-slate-950'}`}><span>{i+1}. {item}</span>{checked[i]&&<CheckCircle2 className="text-emerald-400 shrink-0" size={20}/>}</button>)}</div></section><Link to="/" className="inline-block px-4 py-2 rounded-xl border border-slate-700 bg-slate-900 text-sm"><ArrowRight className="inline ml-1" size={16}/> صفحه اصلی</Link></div></main>;
};
export default DeclarationChecklistPage;
