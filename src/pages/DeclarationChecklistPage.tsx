import React,{useMemo,useRef,useState} from 'react';
import {ArrowRight,Check,FileText,Loader2,Upload,Trash2,Sparkles,Save,Printer,Copy,CheckCircle2} from 'lucide-react';
import {Link} from 'react-router-dom';
import {supabase} from '../lib/supabase';

const items=['در انتظار مبلغ ترخیصیه','پاس کشتی','اظهار','مالیات علی الحساب','درخواست ضمانتنامه حقوق ورودی و ارزش افزوده','ارزیابی','آزمایشگاه','مجوز استاندارد','نوبت کارشناسی','کد ساتا','تبصره دو منطقه آزاد','صورت‌حساب انبارداری اولیه','صورت‌حساب انبارداری متمم','وکالت حمل'];
const STORAGE_KEY='customs_os_declaration_checklist';
const DATA_KEY='customs_os_pre_declaration_data';
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
const loadSaved=()=>{try{return JSON.parse(localStorage.getItem(DATA_KEY)||'{}')}catch{return {}}};

export const DeclarationChecklistPage:React.FC=()=>{
 const[checked,setChecked]=useState<boolean[]>(()=>{try{const p=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');return items.map((_,i)=>Boolean(p?.[i]))}catch{return items.map(()=>false)}});
 const[files,setFiles]=useState<File[]>([]);const[saved,setSaved]=useState<Record<string,string>>(loadSaved);const[values,setValues]=useState<Record<string,string>>(loadSaved);const[needed,setNeeded]=useState(normalize(loadSaved().requiredDocuments||''));const[busy,setBusy]=useState(false);const[status,setStatus]=useState('');const[registered,setRegistered]=useState(Boolean(loadSaved()._registered));const[copied,setCopied]=useState(false);const inputRef=useRef<HTMLInputElement|null>(null);
 const done=checked.filter(Boolean).length;
 const toggle=(i:number)=>setChecked(p=>{const n=p.map((v,j)=>j===i?!v:v);try{localStorage.setItem(STORAGE_KEY,JSON.stringify(n))}catch{}return n});
 const addFiles=(list:FileList|null)=>{if(!list)return;setFiles(p=>[...p,...Array.from(list).filter(f=>/pdf|image\\//i.test(f.type)&&!p.some(x=>x.name===f.name&&x.size===f.size))])};
 const removeFile=(i:number)=>setFiles(p=>p.filter((_,j)=>j!==i));
 const runAI=async()=>{if(!files.length){setStatus('ابتدا اسناد را آپلود کنید.');return}setBusy(true);setStatus('در حال بررسی همه اسناد...');setRegistered(false);try{
   const results:any[]=[];
   for(const file of files){const data=await fileToBase64(file);const {data:res,error}=await supabase.functions.invoke('ai-assistant',{body:{query:prompt,document_data:data,document_mime_type:file.type||'application/pdf',extract_fields:true,page_context:'/operations?tab=pre-declaration'}});if(error)throw error;results.push({name:file.name,answer:res?.answer||res?.message||''})}
   const combined=results.map(r=>`سند: ${r.name}\\n${typeof r.answer==='string'?r.answer:JSON.stringify(r.answer)}`).join('\\n\\n');
   const final=await supabase.functions.invoke('ai-assistant',{body:{query:prompt+'\\n\\nنتایج استخراج‌شده از همه اسناد را با هم تطبیق بده و خروجی نهایی را فقط بر اساس همین اطلاعات تولید کن.',document_text:combined,extract_fields:true,page_context:'/operations?tab=pre-declaration'}});
   if(final.error)throw final.error;
   const raw=final.data?.answer||final.data?.message||{};let parsed:any={};if(typeof raw==='object')parsed=raw;else{try{parsed=JSON.parse(raw)}catch{const m=String(raw).match(/\\{[\\s\\S]*\\}/);if(m)parsed=JSON.parse(m[0])}}
   const mapped:Record<string,string>={};for(const [key] of fields){if(parsed[key]!=null)mapped[key]=normalize(parsed[key]);}
   setValues(v=>({...v,...mapped}));setNeeded(normalize(parsed.requiredDocuments||'ندارد'));setStatus(`${Object.keys(mapped).length} فیلد از اسناد استخراج و در فرم قرار گرفت. اطلاعات را بررسی و سپس «ثبت اطلاعات» را بزنید.`);
 }catch(e:any){setStatus(e?.message||'بررسی اسناد ناموفق بود.')}finally{setBusy(false)}};
 const register=()=>{const data={...values,requiredDocuments:needed||'ندارد',_registered:true,_registeredAt:new Date().toISOString()};try{localStorage.setItem(DATA_KEY,JSON.stringify(data));setSaved(data);setRegistered(true);setStatus('اطلاعات با موفقیت ثبت شد. اکنون می‌توانید چاپ کنید یا متن دقیق قالب را کپی کنید.')}catch{setStatus('ثبت اطلاعات در مرورگر ناموفق بود.')}};
 const outputText=useMemo(()=>{
   const v=(key:string)=>normalize(saved[key]||values[key]||'xxxx')||'xxxx';
   const vessel=v('vesselType'), reg=v('regNumber'), regDate=v('regDate'), pkg=v('packageCount'), wh=v('warehouseReceiptNo'), whDate=v('warehouseReceiptDate'), cargo=v('cargoDescription'), origin=v('originCountry'), trans=v('transactionCountry'), term=v('deliveryTerm'), amount=v('invoiceAmount'), currency=v('invoiceCurrency'), branchCode=v('bankBranchCode'), bank=v('bankName'), branch=v('bankBranch'), lc=v('lcNumber'), duty=v('dutyRate'), tariff=v('tariffCode'), net=v('netWeight'), gross=v('grossWeight'), bl=v('billOfLading'), insurance=v('insuranceIrr'), required=normalize(saved.requiredDocuments||needed||'ندارد')||'ندارد';
   return `نوع کشتی: ${vessel}\\n\\nشماره ثبت سفارش: ${reg}\\nتاریخ ثبت سفارش: ${regDate}\\n\\nتعداد: ${pkg}\\nشماره قبض انبار: ${wh}\\nتاریخ قبض انبار: ${whDate}\\n\\nشرح کالا: ${cargo}\\n\\n•••••••••••••••••••••••••\\nکشور مبدا: ${origin}\\nکشور طرف معامله: ${trans}\\nشرایط تحویل: ${term}\\nمبلغ کل فاکتور: ${amount}\\nارز: ${currency}\\n\\n•••••••••••••••••••••••••\\nاطلاعات بانکی:\\nکد شعبه: ${branchCode}\\nنام بانک: ${bank}\\nشعبه: ${branch}\\nشماره اعتبار اسنادی: ${lc}\\n\\n•••••••••••••••••••••••\\nماخذ حقوق ورودی: ${duty}\\nکد تعرفه کالا: ${tariff}\\nوزن: ${net}/${gross} کیلوگرم\\n\\nبارنامه:\\n${bl}\\n\\n•••••••••••••••••••••••••\\nبیمه (ریال): ${insurance}\\n•••••••••••••••••••••••••\\n\\nاطلاعات مورد نیاز: ${required}`;
 },[saved,values,needed]);
 const copyOutput=async()=>{try{await navigator.clipboard.writeText(outputText);setCopied(true);setTimeout(()=>setCopied(false),1800)}catch{setStatus('کپی متن انجام نشد؛ اجازه دسترسی به کلیپ‌بورد مرورگر را بررسی کنید.')}};
 const printOutput=()=>{if(!registered){setStatus('ابتدا «ثبت اطلاعات» را بزنید.');return}window.print()};
 const displayFiles=useMemo(()=>files.map(f=>f.name),[files]);
 return <>
 <style>{`@media print{body *{visibility:hidden!important}#pre-declaration-print,#pre-declaration-print *{visibility:visible!important}#pre-declaration-print{position:absolute;inset:0;background:#fff!important;color:#000!important;padding:20mm;white-space:pre-wrap;font-family:Tahoma,Arial,sans-serif;font-size:13pt;line-height:2.05;direction:rtl;text-align:right}.no-print{display:none!important}}`}</style>
 <main dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8 no-print"><div className="max-w-5xl mx-auto space-y-5">
  <header className="flex items-center justify-between gap-3"><div><div className="text-xs text-slate-500">CUSTOMS / PRE-DECLARATION</div><h1 className="text-2xl font-black mt-1">ورود اطلاعات قبل اظهار</h1></div><Link to="/operations" className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900 text-sm"><ArrowRight className="inline ml-1" size={16}/> بازگشت</Link></header>
  <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><div className="flex items-center justify-between mb-3"><div><b>آپلود اسناد</b><div className="text-xs text-slate-500 mt-1">یک یا چند سند را انتخاب کنید، سپس «بررسی کن» را بزنید.</div></div><FileText size={20}/></div>
   <input ref={inputRef} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={e=>addFiles(e.target.files)}/><button type="button" onClick={()=>inputRef.current?.click()} className="w-full min-h-28 rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/50 hover:bg-slate-800/50 flex flex-col items-center justify-center gap-2"><Upload size={24}/><span>انتخاب اسناد</span><span className="text-xs text-slate-500">PDF / تصویر</span></button>
   {displayFiles.length>0&&<div className="mt-3 space-y-2">{displayFiles.map((name,i)=><div key={`${name}-${i}`} className="flex items-center justify-between rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm"><span className="truncate">{name}</span><button onClick={()=>removeFile(i)} className="text-red-400 p-1"><Trash2 size={16}/></button></div>)}</div>}
   <button disabled={busy||!files.length} onClick={runAI} className="mt-4 w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-3 font-bold flex items-center justify-center gap-2">{busy?<><Loader2 className="animate-spin" size={18}/>در حال بررسی...</>:<><Sparkles size={18}/>بررسی کن و اطلاعات را استخراج کن</>}</button>{status&&<div className="mt-3 text-sm text-slate-300">{status}</div>}
  </section>
  <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><div className="font-bold mb-4">اطلاعات اظهار</div><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{fields.map(([key,label])=><label key={key} className="block"><span className="text-xs text-slate-400">{label}</span><input value={values[key]||''} onChange={e=>{setValues(v=>({...v,[key]:e.target.value}));setRegistered(false)}} placeholder="xxxx" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-blue-500"/></label>)}</div><label className="block mt-4"><span className="text-xs text-slate-400">اطلاعات مورد نیاز</span><input value={needed} onChange={e=>{setNeeded(e.target.value);setRegistered(false)}} placeholder="ندارد" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-blue-500"/></label>
   <button onClick={register} className="mt-5 w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 py-3 font-bold flex items-center justify-center gap-2"><Save size={18}/>ثبت اطلاعات</button>
  </section>
  {registered&&<section className="bg-emerald-950/40 border border-emerald-700 rounded-2xl p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center"><div className="flex-1 flex items-center gap-2 text-emerald-300 font-bold"><CheckCircle2 size={20}/>اطلاعات با موفقیت ثبت شد</div><button onClick={printOutput} className="rounded-xl bg-white text-slate-900 px-5 py-2.5 font-bold flex items-center justify-center gap-2"><Printer size={18}/>پرینت اطلاعات</button><button onClick={copyOutput} className="rounded-xl bg-slate-800 px-5 py-2.5 font-bold flex items-center justify-center gap-2">{copied?<Check size={18}/>:<Copy size={18}/>} {copied?'کپی شد':'کپی متن'}</button></section>}
  <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><div className="flex items-center justify-between mb-4"><div><div className="font-bold">اظهار / EPL</div><div className="text-xs text-slate-500 mt-1">چک‌لیست مراحل اظهار</div></div><span className="text-xs text-slate-400">{done}/{items.length}</span></div><div className="space-y-2">{items.map((item,i)=><button key={item} onClick={()=>toggle(i)} className={`w-full flex items-center gap-3 rounded-xl border px-3 py-3 text-right ${checked[i]?'border-emerald-700 bg-emerald-950/30':'border-slate-800 bg-slate-950'}`}><span className={`w-6 h-6 rounded-full flex items-center justify-center border ${checked[i]?'bg-emerald-600 border-emerald-600':'border-slate-600'}`}>{checked[i]&&<Check size={15}/>}</span><span>{i+1}. {item}</span></button>)}</div></section>
 </div></main>
 <pre id="pre-declaration-print" className="hidden">{outputText}</pre>
 </>;
};
