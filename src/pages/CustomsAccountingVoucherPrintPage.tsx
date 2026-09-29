import React,{useEffect,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {supabase} from '../lib/supabase';
import '../styles/customs-accounting-voucher.css';
const money=(n:number)=>new Intl.NumberFormat('fa-IR').format(Math.round(Number(n)||0));
const jalali=(v?:string|null)=>v?new Intl.DateTimeFormat('fa-IR-u-ca-persian',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v+'T00:00:00')):'—';
export const CustomsAccountingVoucherPrintPage:React.FC=()=>{
 const [params]=useSearchParams();const id=params.get('id');const[v,setV]=useState<any>();const[lines,setLines]=useState<any[]>([]);const[org,setOrg]=useState<any>();const[actualKottaj,setActualKottaj]=useState('');
 useEffect(()=>{(async()=>{if(!id)return;const{data,error}=await supabase.from('customs_accounting_vouchers').select('*,cases(case_number,registration_order_no,proforma_no,clients(name)),clients(name),customs_declarations(kottaj_number)').eq('id',id).single();if(error)throw error;
  const[{data:l},{data:o},{data:d}]=await Promise.all([supabase.from('voucher_line_items').select('*').eq('voucher_id',id).order('row_number'),supabase.from('organizations').select('name,economic_code').eq('id',data.organization_id).single(),data.declaration_id?supabase.from('customs_declarations').select('kottaj_number').eq('id',data.declaration_id).maybeSingle():Promise.resolve({data:null})]);
  setV(data);setLines(l||[]);setOrg(o);setActualKottaj(d?.kottaj_number||data.customs_declarations?.kottaj_number||'')})().catch(()=>{})},[id]);
 if(!v)return <div className="p-8" dir="rtl">در حال آماده‌سازی سند...</div>;
 return <main className="voucher-print-page" dir="rtl"><div className="no-print print-toolbar"><button onClick={()=>window.print()}>چاپ / ذخیره PDF</button></div><article className="a4-voucher">
  <header className="voucher-header"><div><div className="org-name">{org?.name||'سازمان'}</div><div className="muted">{org?.economic_code?'شناسه اقتصادی: '+org.economic_code:''}</div></div><div className="voucher-title"><div>سند حسابداری هزینه پروانه قطعی</div><strong>{v.company_name}</strong></div><div className="voucher-number">شماره سند<br/><strong dir="ltr">{v.voucher_number}</strong></div></header>
  <section className="meta-grid"><div><b>نوع کالا:</b> {v.cargo_type||'—'}</div><div><b>تناژ:</b> {v.tonnage??'—'} تن</div><div><b>تعداد:</b> {v.unit_count??'—'} {v.unit_type||''}</div><div><b>تاریخ ورود کالا:</b> {jalali(v.cargo_entry_date)}</div><div><b>شماره کوتاژ:</b> <span dir="ltr">{v.kottaj_number||'—'}</span></div><div><b>تاریخ صدور پروانه:</b> {jalali(v.permit_issue_date)}</div><div><b>شماره پرونده:</b> {v.cases?.case_number||'—'}</div><div><b>ثبت سفارش:</b> <span dir="ltr">{v.cases?.registration_order_no||'—'}</span></div></section>
  <table><thead><tr><th>ردیف</th><th>شرح</th><th>شماره فیش</th><th>بدهکار / ریال</th><th>بستانکار / ریال</th></tr></thead><tbody>{lines.map(x=><tr key={x.id} className={x.status==='voided'?'void-row':''}><td>{x.row_number}</td><td>{x.description}{x.description_category?<div className="muted small">{x.description_category}</div>:null}{x.status==='voided'&&x.void_reason?<div className="void-note">باطل — {x.void_reason}</div>:null}</td><td dir="ltr">{x.receipt_number||'—'}</td><td dir="ltr">{Number(x.debit_amount)>0?money(x.debit_amount):''}</td><td dir="ltr">{Number(x.credit_amount)>0?money(x.credit_amount):''}</td></tr>)}</tbody></table>
  <section className="totals"><div>جمع بدهکار: <strong dir="ltr">{money(v.debit_total)} ریال</strong></div><div>جمع بستانکار: <strong dir="ltr">{money(v.credit_total)} ریال</strong></div></section>
  <div className="print-note"><b>کوتاژ ثبت‌شده در اظهار:</b> <span dir="ltr">{actualKottaj||'—'}</span></div>
  <footer><div>تنظیم‌کننده / امضاء</div><div>مهر و امضاء</div></footer>
 </article></main>;
};