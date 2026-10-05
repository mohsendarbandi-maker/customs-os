import React,{useEffect,useState}from'react';
import{ArrowRight,FileText,Lock,Printer,WalletCards}from'lucide-react';
import{Link,useParams}from'react-router-dom';
import{supabase}from'../lib/supabase';
import{useAuth}from'../context/AuthContext';
import{formatMoney}from'../lib/finance';
import{formatJalali}from'../lib/jalali';
import{ShipmentCostsPanel}from'../features/finance/ShipmentCostsPanel';

const money=(n:number)=>formatMoney(n,'IRR');const payStatus=(s:string)=>({draft:'پیش‌نویس',sent:'ارسال‌شده',paid:'پرداخت‌شده',partially_paid:'پرداخت جزئی',issued:'صادرشده',cancelled:'لغوشده'} as Record<string,string>)[s]||s;
export const FinanceShipmentPage:React.FC=()=>{
 const{id}=useParams();const{profile}=useAuth();
 const[s,setS]=useState<any>();const[c,setC]=useState<any>();const[invoices,setInvoices]=useState<any[]>([]);const[requests,setRequests]=useState<any[]>([]);const[payments,setPayments]=useState<any[]>([]);const[vouchers,setVouchers]=useState<any[]>([]);const[msg,setMsg]=useState('');const[tab,setTab]=useState<'costs'|'cash'|'invoices'|'vouchers'|'requests'>('costs');
 const canClose=!!profile&&['owner','admin','accountant'].includes(profile.role);
 const load=async()=>{
  if(!id||!profile?.organization_id)return;
  const[{data:sh,error},{data:iv},{data:pr},{data:pa},{data:vr}]=await Promise.all([
   supabase.from('shipments').select('*').eq('id',id).single(),
   supabase.from('finance_invoice_shipments').select('invoice_id,finance_invoices(id,invoice_no,status,total_amount,currency,issue_date)').eq('shipment_id',id),
   supabase.from('finance_payment_requests').select('*').eq('shipment_id',id).order('request_date',{ascending:false}),
   supabase.from('finance_payments').select('*').eq('shipment_id',id).order('payment_date',{ascending:false}),
   supabase.from('customs_accounting_vouchers').select('id,case_id,voucher_number,kottaj_number,debit_total,credit_total,created_at').order('created_at',{ascending:false})
  ]);
  if(error)setMsg(error.message);setS(sh);setInvoices((iv||[]).map((x:any)=>x.finance_invoices).filter(Boolean));setRequests(pr||[]);setPayments(pa||[]);setVouchers((vr||[]).filter((x:any)=>x.case_id===sh?.case_id));
  if(sh?.client_id){const{data:cl}=await supabase.from('clients').select('id,name').eq('id',sh.client_id).maybeSingle();setC(cl)}
 };
 useEffect(()=>{void load()},[id,profile?.organization_id]);
 const advance=payments.filter(x=>x.payment_type==='advance'&&x.direction==='received').reduce((a,x)=>a+Number(x.amount_irr||0),0);const refund=payments.filter(x=>x.payment_type==='advance_refund'&&x.direction==='paid').reduce((a,x)=>a+Number(x.amount_irr||0),0);const advanceBalance=advance-refund;
 const openInvoices=invoices.filter(x=>['draft','issued','partially_paid'].includes(x.status));const openRequests=requests.filter(x=>['draft','sent','issued','partially_paid'].includes(x.status));const closeReady=s?.finance_status==='ready'&&!openInvoices.length&&!openRequests.length&&advanceBalance===0;
 const close=async()=>{if(!canClose||!s)return;if(!closeReady)return setMsg('برای بستن مالی، صورتحساب‌ها و درخواست‌های وجه باز و مانده تنخواه باید تعیین تکلیف شوند.');setMsg('در حال بستن مالی...');const{error}=await supabase.from('shipments').update({finance_status:'closed',finance_closed_at:new Date().toISOString(),finance_closed_by:profile!.id,updated_at:new Date().toISOString()}).eq('id',s.id).eq('finance_status','ready');if(error)return setMsg(error.message);if(s.case_id){const ce=await supabase.from('cases').update({status:'archived',updated_at:new Date().toISOString()}).eq('id',s.case_id);if(ce.error)return setMsg('مالی بسته شد ولی بایگانی پرونده انجام نشد: '+ce.error.message)}setMsg('مالی بسته شد و پرونده به بایگانی منتقل شد.');await load()};
 return <main className="space-y-5" dir="rtl">
  <div className="flex flex-wrap items-center gap-3"><Link to="/finance" className="icon-btn"><ArrowRight size={18}/></Link><div><h1 className="text-2xl font-black">مالی محموله</h1><p className="app-muted">{s?.display_name||s?.bill_of_lading_no||'—'} · {c?.name||'—'}</p></div><button onClick={()=>window.print()} className="mr-auto px-3 py-2 rounded-xl bg-[var(--primary)] text-white"><Printer size={15} className="inline ml-1"/>چاپ</button></div>
  {msg&&<div className="app-surface border app-border rounded-xl p-3">{msg}</div>}
  <section className="app-surface border app-border rounded-2xl p-4"><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">{[['costs','هزینه‌ها'],['cash','گردش وجه'],['invoices','صورتحساب‌ها'],['vouchers','اسناد حسابداری'],['requests','درخواست وجه']].map(([t,l])=><button key={t} onClick={()=>setTab(t as typeof tab)} className={'px-4 py-3 rounded-xl text-sm font-bold border '+(tab===t?'bg-[var(--primary)] text-white border-transparent':'app-border bg-[var(--surface)]')}>{l}</button>)}</div></section>
  {tab==='costs'&&s&&<ShipmentCostsPanel shipment={s} profile={profile} onChanged={load}/>}
  {tab==='costs'&&!s&&<div className="app-surface p-8 text-center app-muted">در حال بارگذاری محموله…</div>}
  {tab==='cash'&&<section className="app-surface border app-border rounded-2xl p-4"><h2 className="font-bold mb-4"><WalletCards className="inline ml-1" size={18}/>تنخواه و گردش وجه</h2><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b app-border"><th className="p-2 text-right">تاریخ</th><th>نوع</th><th>جهت</th><th>مبلغ</th><th>مرجع</th></tr></thead><tbody>{payments.map(x=><tr key={x.id} className="border-b app-border/50"><td className="p-2">{formatJalali(new Date(x.payment_date+'T12:00:00Z'))}</td><td>{x.payment_type==='advance'?'تنخواه صاحب کالا':x.payment_type==='advance_refund'?'عودت تنخواه':x.payment_type==='invoice_settlement'?'تسویه صورتحساب':x.payment_type==='expense_reimbursement'?'بازپرداخت هزینه':'سایر'}</td><td>{x.direction==='received'?'دریافت':'پرداخت'}</td><td dir="ltr">{money(x.amount_irr)} IRR</td><td>{x.reference_no||'—'}</td></tr>)}</tbody></table>{!payments.length&&<div className="app-muted mt-3">هنوز گردش وجهی ثبت نشده است.</div>}</div>{s?.finance_status==='ready'&&<div className="mt-4 flex items-center justify-between gap-3 rounded-xl border app-border p-3"><span className="text-xs app-muted">وضعیت بستن مالی</span><button disabled={!closeReady} onClick={()=>void close()} className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-bold disabled:opacity-40"><Lock size={15} className="inline ml-1"/>بستن مالی و بایگانی</button></div>}</section>}
  {tab==='invoices'&&<section className="app-surface border app-border rounded-2xl p-4"><h2 className="font-bold mb-4"><FileText className="inline ml-1" size={18}/>صورتحساب‌های مرتبط</h2>{invoices.map(i=><div key={i.id} className="flex justify-between py-3 border-b app-border"><span>{i.invoice_no}</span><span>{money(i.total_amount)} {i.currency} · {payStatus(i.status)}</span></div>)}{!invoices.length&&<div className="app-muted">صورتحسابی ثبت نشده است.</div>}</section>}
  {tab==='vouchers'&&<section className="app-surface border app-border rounded-2xl p-4"><h2 className="font-bold mb-4"><FileText className="inline ml-1" size={18}/>اسناد حسابداری</h2>{vouchers.map(v=><div key={v.id} className="flex flex-wrap justify-between gap-2 py-3 border-b app-border last:border-b-0"><span>سند شماره <b dir="ltr">{v.voucher_number}</b> · کوتاژ <b dir="ltr">{v.kottaj_number||'—'}</b></span><span>{money(v.debit_total)} ریال بدهکار · {money(v.credit_total)} ریال بستانکار <Link to={'/finance/accounting-vouchers/'+v.id} className="text-[var(--primary)] font-bold mr-3">مشاهده</Link></span></div>)}{!vouchers.length&&<div className="app-muted">سند حسابداری برای این پرونده ثبت نشده است.</div>}</section>}
  {tab==='requests'&&<section className="app-surface border app-border rounded-2xl p-4"><h2 className="font-bold mb-4">درخواست‌های وجه</h2>{requests.map(i=><div key={i.id} className="flex justify-between py-3 border-b app-border"><span>{i.request_no}</span><span>{money(i.requested_amount)} {i.currency} · {payStatus(i.status)}</span></div>)}{!requests.length&&<div className="app-muted">درخواست وجهی ثبت نشده است.</div>}</section>}
 </main>;
};
