import React,{useMemo,useRef,useState} from 'react';
import {ArrowRight,Check,FileText,Loader2,Upload,Trash2,Sparkles} from 'lucide-react';
import {Link} from 'react-router-dom';
import {supabase} from '../lib/supabase';

const items=['در انتظار مبلغ ترخیصیه','پاس کشتی','اظهار','مالیات علی الحساب','درخواست ضمانتنامه حقوق ورودی و ارزش افزوده','ارزیابی','آزمایشگاه','مجوز استاندارد','نوبت کارشناسی','کد ساتا','تبصره دو منطقه آزاد','صورت‌حساب انبارداری اولیه','صورت‌حساب انبارداری متمم','وکالت حمل'];
const STORAGE_KEY='customs_os_declaration_checklist';
const fields=[
 ['vesselType','نوع کشتی'],['regNumber','شماره ثبت سفارش'],['regDate','تاریخ ثبت سفارش'],['packageCount','تعداد'],['warehouseReceiptNo','شماره قبض انبار'],['warehouseReceiptDate','تاریخ قبض انبار'],['cargoDescription','شرح کالا'],['originCountry','کشور مبدا'],['transactionCountry','کشور طرف معامله'],['deliveryTerm','شرایط تحویل'],['invoiceAmount','مبلغ کل فاکتور'],['invoiceCurrency','ارز'],['bankBranchCode','کد شعبه'],['bankName','نام بانک'],['bankBranch','شعبه'],['lcNumber','شماره اعتبار اسنادی'],['dutyRate','ماخذ حقوق ورودی'],['tariffCode','کد تعرفه کالا'],['netWeight','وزن خالص'],['grossWeight','وزن ناخالص'],['billOfLading','بارنامه'],['insuranceIrr','بیمه (ریال)'],
] as const;
const prompt=`من اسناد حمل یک محموله وارداتی شامل این مدارک را برایت ارسال می‌کنم: اینویس، پکینگ لیست، بارنامه، بیمه‌نامه، قبض انبار، ترخیصیه، ثبت سفارش، پروفرما و در صورت وجود گواهی بازرسی.

وظیفه تو این است که فقط بر اساس اطلاعات موجود در اسناد، به عنوان «کارشناس خبره امور گمرکی و سامانه EPL» اطلاعات مورد نیاز اظهارنامه را استخراج و محاسبه کنی.

قوانین الزامی:
1. هیچ اطلاعاتی را حدس نزن و از خودت ایجاد نکن.
2. اگر اطلاعاتی در اسناد وجود ندارد، دقیقاً xxxx بنویس.
3. اگر کشور طرف معامله در اسناد مشخص نیست، xxxx بنویس.
4. اگر پرچم یا مالک کشتی ایرانی باشد ایرانی و در غیر این صورت خارجی بنویس.
5. شماره بارنامه دقیقاً مطابق اصل بارنامه استخراج شود؛ حروف، اعداد، /، - و سایر علائم عیناً حفظ شود و فقط با حروف و اعداد انگلیسی در یک خط جداگانه نوشته شود.
6. تاریخ‌ها شمسی باشند.
7. اطلاعات بانکی: کد شعبه، نام بانک و نام شعبه را از بیمه‌نامه یا سایر اسناد استخراج کن؛ فقط بانک ایرانی. مهر بانک و کد شعبه/شماره ابزار پرداخت دست‌نویس روی مهر را نیز بررسی کن. اگر روش پرداخت TT، نقدی یا مشابه است شماره اعتبار اسنادی را دقیقاً --- بنویس. اگر اطلاعات بانکی نیست xxxx.
8. شرح کالا بدون کد تعرفه باشد. برای رول آهنی عبارت «آهن ورق گرم سایز» و سپس سایز؛ برای تخته عبارت «تخته بسته» و سپس مشخصات. برای تعرفه 72083900 عبارت پایه دقیقاً «آهن ورق گرم سایز» باشد. عبارت کد تعرفه، HS Code، ورق فولادی یا توضیح غیرموجود اضافه نکن.
9. ماخذ حقوق ورودی فقط از جدول ثبت سفارش استخراج شود و درصد باشد.
10. کد تعرفه دقیقاً مطابق ثبت سفارش.
11. وزن خالص و ناخالص از اسناد؛ اگر فقط یکی موجود بود همان مقدار.
12. مبلغ کل ریالی حق بیمه را استخراج کن. اگر تناژ کل پروفرما با وزن خالص وارداتی طبق بارنامه متفاوت بود، بیمه ریالی را متناسب با نسبت وزن خالص وارداتی به تناژ کل بیمه‌شده/پروفرما محاسبه کن و فقط مبلغ ریالی بده.
13. کشور مبدا و کشور طرف معامله فقط از اسناد؛ کد دوحرفی در صورت وجود/قابل تشخیص.
14. شرایط تحویل دقیقاً از اسناد.
15. مبلغ کل فاکتور و ارز دقیقاً مطابق اینویس.
16. تعداد بسته از پکینگ لیست.
17. شماره و تاریخ قبض انبار از قبض انبار.
18. شماره و تاریخ ثبت سفارش از ثبت سفارش.
19. اطلاعات درخواستی از صاحب کالا: ثبت سفارش، اینویس، پروفرما، بیمه‌نامه، پکینگ لیست، اطلاعات بانکی، گواهی بازرسی.
20. اسناد دریافتی توسط حق‌العملکار و غیرقابل درخواست از صاحب کالا: ترخیصیه، بارنامه، قبض انبار، ترخیصیه الکترونیک.
21. اطلاعات مورد نیاز فقط نام مدارکی باشد که از صاحب کالا لازم است و در اسناد ارسالی موجود نیست.
22. در اطلاعات مورد نیاز هیچ توضیح یا تحلیل ننویس.
23. اگر هیچ مدرکی لازم نیست «ندارد».
24. همه اطلاعات را استخراج و محاسبات نهایی را انجام بده.`;
const fileToBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const s=String(r.result||'');resolve(s.includes(',')?s.split(',')[1]:s)};r.onerror=()=>reject(new Error('خواندن فایل ناموفق بود'));r.readAsDataURL(file)});
const normalize=(v:any)=>String(v??'').trim();

export const DeclarationChecklistPage:React.FC=()=>{
 const[checked,setChecked]=useState<boolean[]>(()=>{try{const p=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');return items.map((_,i)=>Boolean(p?.[i]))}catch{return items.map(()=>false)}});
 const[files,setFiles]=useState<File[]>([]);const[values,setValues]=useState<Record<string,string>>({});const[needed,setNeeded]=useState('');const[busy,setBusy]=useState(false);const[status,setStatus]=useState('');const inputRef=useRef<HTMLInputElement|null>(null);
 const done=checked.filter(Boolean).length;
 const toggle=(i:number)=>setChecked(p=>{const n=p.map((v,j)=>j===i?!v:v);try{localStorage.setItem(STORAGE_KEY,JSON.stringify(n))}catch{}return n});
 const addFiles=(list:FileList|null)=>{if(!list)return;setFiles(p=>[...p,...Array.from(list).filter(f=>/pdf|image\//i.test(f.type)&&!p.some(x=>x.name===f.name&&x.size===f.size))])};
 const removeFile=(i:number)=>setFiles(p=>p.filter((_,j)=>j!==i));
 const runAI=async()=>{if(!files.length){setStatus('ابتدا اسناد را آپلود کنید.');return}setBusy(true);setStatus('در حال بررسی همه اسناد...');try{
   const results:any[]=[];
   for(const file of files){const data=await fileToBase64(file);const {data:res,error}=await supabase.functions.invoke('ai-assistant',{body:{query:prompt,document_data:data,document_mime_type:file.type||'application/pdf',extract_fields:true,page_context:'/operations?tab=pre-declaration'}});if(error)throw error;results.push({name:file.name,answer:res?.answer||res?.message||''})}
   const combined=results.map(r=>`سند: ${r.name}\n${typeof r.answer==='string'?r.answer:JSON.stringify(r.answer)}`).join('\n\n');
   const final=await supabase.functions.invoke('ai-assistant',{body:{query:prompt+'\n\nنتایج استخراج‌شده از همه اسناد را با هم تطبیق بده و خروجی نهایی را فقط بر اساس همین اطلاعات تولید کن.',document_text:combined,extract_fields:true,page_context:'/operations?tab=pre-declaration'}});
   if(final.error)throw final.error;
   const raw=final.data?.answer||final.data?.message||{};let parsed:any={};if(typeof raw==='object')parsed=raw;else{try{parsed=JSON.parse(raw)}catch{const m=String(raw).match(/\{[\s\S]*\}/);if(m)parsed=JSON.parse(m[0])}}
   const mapped:Record<string,string>={};for(const [key] of fields){if(parsed[key]!=null)mapped[key]=normalize(parsed[key]);}
   setValues(v=>({...v,...mapped}));setNeeded(normalize(parsed.requiredDocuments||'ندارد'));
   setStatus(`${Object.keys(mapped).length} فیلد از اسناد استخراج و در فرم قرار گرفت.`);
 }catch(e:any){setStatus(e?.message||'بررسی اسناد ناموفق بود.')}finally{setBusy(false)}};
 const displayFiles=useMemo(()=>files.map(f=>f.name),[files]);
 return <main dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8"><div className="max-w-5xl mx-auto space-y-5">
  <header className="flex items-center justify-between gap-3"><div><div className="text-xs text-slate-500">CUSTOMS / PRE-DECLARATION</div><h1 className="text-2xl font-black mt-1">ورود اطلاعات قبل اظهار</h1></div><Link to="/operations" className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900 text-sm"><ArrowRight className="inline ml-1" size={16}/> بازگشت</Link></header>
  <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><div className="flex items-center justify-between mb-3"><div><b>آپلود اسناد</b><div className="text-xs text-slate-500 mt-1">یک یا چند سند را انتخاب کنید، سپس «بررسی کن» را بزنید.</div></div><FileText size={20}/></div>
   <input ref={inputRef} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={e=>addFiles(e.target.files)}/><button type="button" onClick={()=>inputRef.current?.click()} className="w-full min-h-28 rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/50 hover:bg-slate-800/50 flex flex-col items-center justify-center gap-2"><Upload size={24}/><span>انتخاب اسناد</span><span className="text-xs text-slate-500">PDF / تصویر</span></button>
   {displayFiles.length>0&&<div className="mt-3 space-y-2">{displayFiles.map((name,i)=><div key={`${name}-${i}`} className="flex items-center justify-between rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm"><span className="truncate">{name}</span><button onClick={()=>removeFile(i)} className="text-red-400 p-1"><Trash2 size={16}/></button></div>)}</div>}
   <button disabled={busy||!files.length} onClick={runAI} className="mt-4 w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-3 font-bold flex items-center justify-center gap-2">{busy?<><Loader2 className="animate-spin" size={18}/>در حال بررسی...</>:<><Sparkles size={18}/>بررسی کن و اطلاعات را استخراج کن</>}</button>{status&&<div className="mt-3 text-sm text-slate-300">{status}</div>}
  </section>
  <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><div className="font-bold mb-4">اطلاعات اظهار</div><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{fields.map(([key,label])=><label key={key} className="block"><span className="block text-xs text-slate-400 mb-1">{label}</span><input value={values[key]||''} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))} placeholder="xxxx" className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5 outline-none focus:border-blue-500"/></label>)}</div><div className="mt-4"><span className="block text-xs text-slate-400 mb-1">اطلاعات مورد نیاز</span><input value={needed} onChange={e=>setNeeded(e.target.value)} placeholder="ندارد" className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5"/></div></section>
  <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden"><div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between"><b>اظهار / EPL</b><span className="text-xs text-slate-500">{done} از {items.length} انجام شد</span></div>{items.map((item,i)=><button key={item} type="button" onClick={()=>toggle(i)} className="w-full flex items-center gap-4 px-5 py-4 text-right border-b border-slate-800 last:border-0 hover:bg-slate-800/60"><span className={`shrink-0 w-9 h-9 rounded-md border-2 flex items-center justify-center ${checked[i]?'border-blue-500 bg-blue-500/10 text-blue-400':'border-blue-500 text-transparent'}`}><Check size={21}/></span><span className={checked[i]?'text-slate-500 line-through':'text-slate-200'}>{item}</span></button>)}</section>
 </div></main>;
};
export default DeclarationChecklistPage;
