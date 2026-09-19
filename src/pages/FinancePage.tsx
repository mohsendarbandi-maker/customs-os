import React,{useEffect,useMemo,useState} from 'react';
import {BarChart3,FileText,Plus,Receipt,RefreshCw,Search,WalletCards,ArrowLeft} from 'lucide-react';
import {Link} from 'react-router-dom';
import {supabase} from '../lib/supabase';
import {useAuth} from '../context/AuthContext';

const money=(n:number)=>new Intl.NumberFormat('fa-IR').format(Math.round(Number(n)||0));
const num=(v:string)=>Number((v||'').replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/,/g,''));
const currencies=['IRR','USD','EUR','AED','CNY','RUB','GBP','CHF','TRY'];

export const FinancePage:React.FC=()=>{
 const {profile}=useAuth();
 const [tab,setTab]=useState('overview'),[shipments,setShipments]=useState<any[]>([]),[clients,setClients]=useState<any[]>([]),[cats,setCats]=useState<any[]>([]),[costs,setCosts]=useState<any[]>([]),[invoices,setInvoices]=useState<any[]>([]),[requests,setRequests]=useState<any[]>([]),[payments,setPayments]=useState<any[]>([]);
 const [search,setSearch]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[selected,setSelected]=useState<string[]>([]);
 const [form,setForm]=useState<any>({shipment_id:'',category_id:'',description:'',quantity:'1',unit:'',unit_price:'',currency:'IRR',exchange_rate:'1',vat_rate:'0',payable_by:'client',billable:true,reimbursable:false});
 const canWrite=!!profile&&['owner','admin','accountant'].includes(profile.role);
 const load=async()=>{
  setBusy(true);
  const [s,c,ca,co,iv,pr,pa]=await Promise.all([
   supabase.from('shipments').select('id,case_id,client_id,display_name,bill_of_lading_no,cargo_count,cargo_count_unit,current_status').order('created_at',{ascending:false}),
   supabase.from('clients').select('id,name').order('name'),
   supabase.from('finance_cost_categories').select('id,name_fa').eq('is_active',true).order('sort_order'),
   supabase.from('finance_cost_items').select('*').order('occurred_at',{ascending:false}),
   supabase.from('finance_invoices').select('*').order('issue_date',{ascending:false}),
   supabase.from('finance_payment_requests').select('*').order('request_date',{ascending:false}),
   supabase.from('finance_payments').select('*').order('payment_date',{ascending:false})
  ]);
  const err=[s,c,ca,co,iv,pr,pa].find(x=>x.error)?.error;if(err)setMsg(err.message);
  setShipments(s.data||[]);setClients(c.data||[]);setCats(ca.data||[]);setCosts(co.data||[]);setInvoices(iv.data||[]);setRequests(pr.data||[]);setPayments(pa.data||[]);setBusy(false);
 };
 useEffect(()=>{load()},[]);
 const cn=(id:string)=>clients.find(x=>x.id===id)?.name||'—';
 const sn=(id:string)=>{const x=shipments.find(s=>s.id===id);return x?.display_name||x?.bill_of_lading_no||id?.slice(0,8)||'—'};
 const filtered=useMemo(()=>shipments.filter(s=>{const q=search.trim().toLowerCase();return !q||[s.display_name,s.bill_of_lading_no,cn(s.client_id)].join(' ').toLowerCase().includes(q)}),[shipments,clients,search]);
 const totalCost=costs.filter(x=>x.status!=='cancelled').reduce((a,x)=>a+Number(x.amount_irr||0)+Number(x.vat_amount||0),0);
 const totalInv=invoices.filter(x=>x.status!=='void').reduce((a,x)=>a+Number(x.total_amount||0),0);
 const received=payments.filter(x=>x.direction==='received').reduce((a,x)=>a+Number(x.amount_irr||0),0);
 const orgCost=costs.filter(x=>x.status!=='cancelled'&&!x.reimbursable&&x.payable_by==='organization').reduce((a,x)=>a+Number(x.amount_irr||0)+Number(x.vat_amount||0),0);
 const addCost=async()=>{
  if(!canWrite)return;const s=shipments.find(x=>x.id===form.shipment_id),q=num(form.quantity),p=num(form.unit_price),r=num(form.exchange_rate),v=num(form.vat_rate);
  if(!s||!form.category_id||!form.description.trim()||q<=0||p<0||r<=0){setMsg('محموله، دسته، شرح، مقدار و مبلغ معتبر الزامی است.');return}
  const amount=Math.round(q*p*100)/100,irr=Math.round(amount*r*100)/100,vat=Math.round(irr*v/100*100)/100;setBusy(true);
  const {error}=await supabase.from('finance_cost_items').insert({organization_id:profile!.organization_id,shipment_id:s.id,case_id:s.case_id||null,client_id:s.client_id,category_id:form.category_id,description:form.description.trim(),quantity:q,unit:form.unit||null,unit_price:p,amount,currency:form.currency,exchange_rate:r,amount_irr:irr,vat_rate:v,vat_amount:vat,payable_by:form.payable_by,billable:form.billable,reimbursable:form.reimbursable,status:'confirmed',created_by:profile!.id,updated_by:profile!.id});
  if(error)setMsg(error.message);else{setMsg('هزینه ثبت شد.');setShow(false);setForm({shipment_id:'',category_id:'',description:'',quantity:'1',unit:'',unit_price:'',currency:'IRR',exchange_rate:'1',vat_rate:'0',payable_by:'client',billable:true,reimbursable:false});await load()}setBusy(false);
 };
 const makeInvoice=async()=>{
  const rows=costs.filter(x=>selected.includes(x.id)&&x.status==='confirmed'&&x.billable);if(!rows.length){setMsg('هزینه تاییدشده و قابل صورتحساب انتخاب کنید.');return}
  const ids=[...new Set(rows.map(x=>x.client_id))];if(ids.length!==1){setMsg('همه اقلام باید متعلق به یک صاحب کالا باشند.');return}
  const st=await supabase.from('finance_org_settings').select('invoice_prefix,next_invoice_number').eq('organization_id',profile!.organization_id).maybeSingle();
  const seq=Number(st.data?.next_invoice_number||1),prefix=st.data?.invoice_prefix||'FIN',year=new Date().getFullYear(),no=prefix+'-'+year+'-'+String(seq).padStart(5,'0');
  const sub=rows.reduce((a,x)=>a+Number(x.amount_irr||0),0),vat=rows.reduce((a,x)=>a+Number(x.vat_amount||0),0);setBusy(true);
  const ins=await supabase.from('finance_invoices').insert({organization_id:profile!.organization_id,client_id:ids[0],invoice_no:no,invoice_year:year,status:'draft',subtotal:sub,vat_amount:vat,total_amount:sub+vat,currency:'IRR',created_by:profile!.id,updated_by:profile!.id}).select('id').single();
  if(ins.error){setMsg(ins.error.message);setBusy(false);return}
  const id=ins.data.id;
  const li=await supabase.from('finance_invoice_lines').insert(rows.map((x,i)=>({organization_id:profile!.organization_id,invoice_id:id,cost_item_id:x.id,shipment_id:x.shipment_id,line_type:'cost',description:x.description,quantity:x.quantity,unit:x.unit,unit_price:x.unit_price,amount:x.amount_irr,vat_rate:x.vat_rate,vat_amount:x.vat_amount,sort_order:i})));
  const si=await supabase.from('finance_invoice_shipments').insert([...new Set(rows.map(x=>x.shipment_id))].map(shipment_id=>({invoice_id:id,organization_id:profile!.organization_id,shipment_id})));
  if(!li.error&&!si.error){await supabase.from('finance_cost_items').update({status:'invoiced',updated_by:profile!.id}).in('id',rows.map(x=>x.id));await supabase.from('finance_org_settings').update({next_invoice_number:seq+1}).eq('organization_id',profile!.organization_id);setMsg('صورتحساب '+no+' ایجاد شد.');setSelected([]);await load()}else setMsg(li.error?.message||si.error?.message||'خطا در ایجاد صورتحساب');setBusy(false);
 };
 const tabs=[['overview','نمای کلی',BarChart3],['costs','هزینه‌ها',Receipt],['invoices','صورتحساب‌ها',FileText],['requests','درخواست وجه',FileText],['payments','پرداخت‌ها',WalletCards],['pnl','سود و زیان',BarChart3]] as any[];
 return <main className="space-y-5" dir="rtl">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-black">مرکز مالی</h1><p className="app-muted text-sm mt-1">منبع مالی بر مبنای محموله، نه یک دفتر موازی با عملیات</p></div><div className="flex gap-2"><button onClick={load} className="icon-btn"><RefreshCw size={18}/></button>{canWrite&&<button onClick={()=>setShow(true)} className="px-4 py-2 rounded-xl bg-[var(--primary)] text-white font-bold"><Plus size={16} className="inline ml-1"/>هزینه جدید</button>}</div></header>
  {msg&&<div className="app-surface border app-border rounded-xl p-3 text-sm">{msg}</div>}
  <div className="grid grid-cols-2 xl:grid-cols-4 gap-3"><Metric title="کل هزینه" value={totalCost}/><Metric title="صورتحساب" value={totalInv}/><Metric title="دریافتی" value={received}/><Metric title="سود عملیاتی" value={totalInv-orgCost}/></div>
  <div className="flex flex-wrap gap-2">{tabs.map(([k,l,I])=><button key={k} onClick={()=>setTab(k)} className={'px-4 py-2 rounded-xl border '+(tab===k?'bg-[var(--primary)] text-white border-transparent':'app-surface app-border')}><I size={15} className="inline ml-1"/>{l}</button>)}</div>
  {tab==='overview'&&<section className="app-surface border app-border rounded-2xl p-4"><div className="flex justify-between mb-4"><h2 className="font-bold">محموله‌ها</h2><div className="relative"><Search size={15} className="absolute right-3 top-3 app-muted"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="جستجوی محموله / B/L / صاحب کالا" className="pr-9 p-2 rounded-xl border app-border bg-transparent"/></div></div><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b app-border"><th className="p-2 text-right">محموله</th><th>صاحب کالا</th><th>B/L</th><th>هزینه</th><th>وضعیت</th><th></th></tr></thead><tbody>{filtered.map(s=>{const t=costs.filter(x=>x.shipment_id===s.id&&x.status!=='cancelled').reduce((a,x)=>a+Number(x.amount_irr||0)+Number(x.vat_amount||0),0);return <tr key={s.id} className="border-b app-border/50"><td className="p-2 font-semibold">{s.display_name||s.bill_of_lading_no||'محموله'}</td><td>{cn(s.client_id)}</td><td dir="ltr">{s.bill_of_lading_no||'—'}</td><td dir="ltr">{money(t)} IRR</td><td>{s.current_status||'—'}</td><td><Link to={'/finance/shipments/'+s.id} className="text-[var(--primary)] font-bold">مالی محموله <ArrowLeft size={14} className="inline mr-1"/></Link></td></tr>})}</tbody></table></div></section>}
  {tab==='costs'&&<section className="app-surface border app-border rounded-2xl p-4"><div className="flex justify-between mb-4"><h2 className="font-bold">هزینه‌های عملیاتی</h2>{selected.length>0&&<button disabled={!canWrite||busy} onClick={makeInvoice} className="px-4 py-2 rounded-xl bg-emerald-700 text-white">ایجاد صورتحساب ({selected.length})</button>}</div><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b app-border"><th></th><th>محموله</th><th>دسته</th><th>شرح</th><th>مبلغ</th><th>وضعیت</th></tr></thead><tbody>{costs.map(x=><tr key={x.id} className="border-b app-border/50"><td><input type="checkbox" disabled={!canWrite||x.status!=='confirmed'||!x.billable} checked={selected.includes(x.id)} onChange={e=>setSelected(p=>e.target.checked?p.concat(x.id):p.filter(id=>id!==x.id))}/></td><td>{sn(x.shipment_id)}</td><td>{cats.find(c=>c.id===x.category_id)?.name_fa||'—'}</td><td>{x.description}</td><td dir="ltr">{money(Number(x.amount_irr)+Number(x.vat_amount||0))} IRR</td><td>{x.status}</td></tr>)}</tbody></table></div></section>}
  {tab==='invoices'&&<Simple title="صورتحساب‌ها" rows={invoices.map(x=>({no:x.invoice_no,client:cn(x.client_id),date:x.issue_date,total:money(x.total_amount)+' '+x.currency,status:x.status}))}/>}
  {tab==='requests'&&<Simple title="درخواست‌های وجه" rows={requests.map(x=>({no:x.request_no,client:cn(x.client_id),date:x.request_date,total:money(x.requested_amount)+' '+x.currency,status:x.status}))}/>}
  {tab==='payments'&&<Simple title="پرداخت‌ها" rows={payments.map(x=>({no:x.payment_no||'—',client:cn(x.client_id),date:new Date(x.payment_date).toLocaleDateString('fa-IR'),total:money(x.amount_irr)+' IRR',status:x.direction==='received'?'دریافت':'پرداخت'}))}/>}
  {tab==='pnl'&&<div className="grid md:grid-cols-3 gap-3"><Metric title="درآمد صورتحساب‌شده" value={totalInv}/><Metric title="هزینه واقعی سازمان" value={orgCost}/><Metric title="سود عملیاتی" value={totalInv-orgCost}/></div>}
  {show&&<div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"><div className="w-full max-w-3xl app-surface border app-border rounded-2xl p-5 max-h-[90vh] overflow-auto"><div className="flex justify-between"><h2 className="font-black text-lg">ثبت هزینه محموله</h2><button onClick={()=>setShow(false)}>×</button></div><div className="grid md:grid-cols-2 gap-3 mt-4"><Field label="محموله"><select value={form.shipment_id} onChange={e=>setForm({...form,shipment_id:e.target.value})} className="input"><option value="">انتخاب</option>{shipments.map(s=><option key={s.id} value={s.id}>{s.display_name||s.bill_of_lading_no||s.id.slice(0,8)} — {cn(s.client_id)}</option>)}</select></Field><Field label="دسته"><select value={form.category_id} onChange={e=>setForm({...form,category_id:e.target.value})} className="input"><option value="">انتخاب</option>{cats.map(c=><option key={c.id} value={c.id}>{c.name_fa}</option>)}</select></Field>{[['description','شرح'],['quantity','مقدار'],['unit','واحد'],['unit_price','قیمت واحد'],['exchange_rate','نرخ تبدیل'],['vat_rate','VAT %']].map(([k,l])=><Field key={k} label={l}><input value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} className="input" dir={['description','unit'].includes(k)?'rtl':'ltr'}/></Field>)}<Field label="ارز"><select value={form.currency} onChange={e=>setForm({...form,currency:e.target.value})} className="input" dir="ltr">{currencies.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="پرداخت‌کننده"><select value={form.payable_by} onChange={e=>setForm({...form,payable_by:e.target.value})} className="input"><option value="client">صاحب کالا</option><option value="organization">شرکت</option><option value="third_party">شخص ثالث</option></select></Field></div><div className="flex gap-5 mt-4 text-sm"><label><input type="checkbox" checked={form.billable} onChange={e=>setForm({...form,billable:e.target.checked})}/> قابل صورتحساب</label><label><input type="checkbox" checked={form.reimbursable} onChange={e=>setForm({...form,reimbursable:e.target.checked})}/> عبوری</label></div><button onClick={addCost} disabled={busy} className="mt-5 px-5 py-3 rounded-xl bg-[var(--primary)] text-white font-bold">ثبت هزینه</button></div></div>}
 </main>;
};
const Field=({label,children}:{label:string,children:any})=><label className="text-xs app-muted">{label}{children}</label>;
const Simple=({title,rows}:{title:string,rows:any[]})=><section className="app-surface border app-border rounded-2xl p-4"><h2 className="font-bold mb-4">{title}</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b app-border"><th className="p-2 text-right">شماره</th><th>صاحب کالا</th><th>تاریخ</th><th>مبلغ</th><th>وضعیت</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i} className="border-b app-border/50"><td className="p-2">{r.no}</td><td>{r.client}</td><td>{r.date}</td><td dir="ltr">{r.total}</td><td>{r.status}</td></tr>)}</tbody></table>{!rows.length&&<div className="p-6 text-center app-muted">موردی ثبت نشده.</div>}</div></section>;
const Metric=({title,value}:{title:string,value:number})=><div className="app-surface border app-border rounded-2xl p-4"><div className="text-xs app-muted">{title}</div><div className="text-xl font-black mt-2">{money(value)} <span className="text-xs">ریال</span></div></div>;
