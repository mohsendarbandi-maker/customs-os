import React,{useEffect,useState} from 'react';
import {ArrowRight,Check} from 'lucide-react';
import {Link} from 'react-router-dom';

const items=[
 'در انتظار مبلغ ترخیصیه',
 'پاس کشتی',
 'اظهار',
 'مالیات علی الحساب',
 'درخواست ضمانتنامه حقوق ورودی و ارزش افزوده',
 'ارزیابی',
 'آزمایشگاه',
 'مجوز استاندارد',
 'نوبت کارشناسی',
 'کد ساتا',
 'تبصره دو منطقه آزاد',
 'صورت‌حساب انبارداری اولیه',
 'صورت‌حساب انبارداری متمم',
 'وکالت حمل',
];

const STORAGE_KEY='customs_os_declaration_checklist';

export const DeclarationChecklistPage:React.FC=()=>{
 const[checked,setChecked]=useState<boolean[]>(()=>{
  try{
   const raw=localStorage.getItem(STORAGE_KEY);
   const parsed=raw?JSON.parse(raw):[];
   return items.map((_,i)=>Boolean(parsed?.[i]));
  }catch{return items.map(()=>false)}
 });

 useEffect(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(checked))}catch{}},[checked]);

 const toggle=(index:number)=>setChecked(prev=>prev.map((v,i)=>i===index?!v:v));
 const done=checked.filter(Boolean).length;

 return <main dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8">
  <div className="max-w-3xl mx-auto">
   <header className="flex items-center justify-between gap-3 mb-5">
    <div>
     <div className="text-xs text-slate-500">EPL / DECLARATION</div>
     <h1 className="text-2xl font-black mt-1">اظهار</h1>
    </div>
    <Link to="/operations" className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900 text-sm">
     <ArrowRight className="inline ml-1" size={16}/> بازگشت
    </Link>
   </header>

   <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
    <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
     <div className="font-bold">چک لیست اظهار</div>
     <div className="text-xs text-slate-500">{done} از {items.length} انجام شد</div>
    </div>

    <div>
     {items.map((item,index)=><button key={item} type="button" onClick={()=>toggle(index)} className="w-full flex items-center gap-4 px-5 py-4 text-right border-b border-slate-800 last:border-b-0 hover:bg-slate-800/60 transition">
      <span className={`shrink-0 w-9 h-9 rounded-md border-2 flex items-center justify-center ${checked[index]?'border-blue-500 bg-blue-500/10 text-blue-400':'border-blue-500 text-transparent'}`}>
       <Check size={21}/>
      </span>
      <span className={`text-base sm:text-lg ${checked[index]?'text-slate-500 line-through':'text-slate-200'}`}>{item}</span>
     </button>)}
    </div>
   </section>
  </div>
 </main>;
};

export default DeclarationChecklistPage;
