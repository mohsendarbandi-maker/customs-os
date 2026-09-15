import React,{useEffect,useState} from 'react';
import {ArrowRight,Save,RotateCcw} from 'lucide-react';
import {Link} from 'react-router-dom';

type FormState=Record<string,string>;
const fields:[string,string][]=[
 ['proformaNumber','پروفرما'],['proformaDate','تاریخ پروفرما'],['invoiceNumber','فاکتور'],['invoiceDate','تاریخ فاکتور'],
 ['vesselType','نوع کشتی'],['registrationOrder','شماره ثبت سفارش'],['registrationDate','تاریخ ثبت سفارش'],['quantity','تعداد'],
 ['warehouseReceiptNumber','شماره قبض انبار'],['warehouseReceiptDate','تاریخ قبض انبار'],['cargoDescription','شرح کالا'],
 ['originCountry','کشور مبدأ'],['transactionCountry','کشور طرف معامله'],['deliveryTerm','شرایط تحویل'],['invoiceAmount','مبلغ کل فاکتور'],['currency','ارز'],
 ['bankBranchCode','کد شعبه'],['bankName','نام بانک'],['branch','شعبه'],['paymentInstrumentNumber','شماره اعتبار اسنادی (شماره ابزار پرداخت)'],['sataCode','کد ساتا'],
 ['dutyBase','ماخذ حقوق ورودی'],['tariffCode','کد تعرفه کالا'],['netWeight','وزن خالص'],['grossWeight','وزن ناخالص'],['billOfLading','بارنامه']
];
const defaults:FormState={vesselType:'ایرانی',deliveryTerm:'CFR',currency:'USD'};
const KEY='customs_os_pre_declaration';
export const PreDeclarationPage:React.FC=()=>{
 const[form,setForm]=useState<FormState>({...defaults});const[saved,setSaved]=useState(false);
 useEffect(()=>{try{const x=JSON.parse(localStorage.getItem(KEY)||'null');if(x)setForm({...defaults,...x})}catch{}},[]);
 const set=(k:string,v:string)=>{setSaved(false);setForm(p=>({...p,[k]:v}))};
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(form));setSaved(true)}catch{}};
 const reset=()=>{setForm({...defaults});setSaved(false);try{localStorage.removeItem(KEY)}catch{}};
 return <main dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8"><div className="max-w-5xl mx-auto">
  <header className="flex items-center justify-between gap-3 mb-5"><div><div className="text-xs text-slate-500">CUSTOMS / PRE-DECLARATION</div><h1 className="text-2xl font-black mt-1">۱- ورود اطلاعات قبل اظهار</h1></div><Link to="/operations?tab=declaration" className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900 text-sm"><ArrowRight className="inline ml-1" size={16}/> اظهار / EPL</Link></header>
  <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
   {fields.map(([key,label])=><label key={key} className="block"><span className="block text-sm text-slate-300 mb-1">{label}</span><input value={form[key]||''} onChange={e=>set(key,e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none focus:border-blue-500" /></label>)}
  </div><div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-slate-800"><button onClick={reset} className="px-4 py-2.5 rounded-xl border border-slate-700 text-sm"><RotateCcw className="inline ml-1" size={16}/> پاک کردن</button><div className="flex items-center gap-3"><span className="text-sm text-emerald-400">{saved?'ذخیره شد':''}</span><button onClick={save} className="px-5 py-2.5 rounded-xl bg-blue-600 text-white font-bold"><Save className="inline ml-1" size={17}/> ذخیره اطلاعات</button></div></div></section>
 </div></main>;
};
export default PreDeclarationPage;
