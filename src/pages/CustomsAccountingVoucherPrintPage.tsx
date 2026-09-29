import React,{useEffect,useState}from'react';
import{useSearchParams}from'react-router-dom';
import{supabase}from'../lib/supabase';
import'../styles/customs-accounting-voucher.css';
import{isoToJalali}from'../lib/shared/jalali';

const money=(n:number)=>new Intl.NumberFormat('fa-IR').format(Math.round(Number(n)||0));

export const CustomsAccountingVoucherPrintPage:React.FC=()=>{
 const[params]=useSearchParams();const id=params.get('id');const[v,setV]=useState<any>();const[lines,setLines]=useState<any[]>([]);const[org,setOrg]=useState<any>();
 useEffect(()=>{(async()=>{if(!id)return;const{data,error}=await supabase.from('customs_accounting_vouchers').select('*,cases(cargo_description,clients(name)),clients(name)').eq('id',id).single();if(error)throw error;
  const[{data:l},{data:o}]=await Promise.all([
    supabase.from('voucher_line_items').select('*').eq('voucher_id',id).order('row_number'),
    supabase.from('organizations').select('name,economic_code').eq('id',data.organization_id).single()
  ]);
  setV(data);setLines(l||[]);setOrg(o);
 })().catch(()=>{})},[id]);
 if(!v)return <div className="p-8" dir="rtl">در حال آماده‌سازی سند...</div>;
 const balanced=Boolean(v.is_balanced);const balance=Number(v.balance_total||0);
 return <main className="voucher-print-page" dir="rtl">
  <div className="no-print print-toolbar"><button onClick={()=>{document.title='سند حسابداری هزینه پروانه قطعی - '+v.voucher_number;window.print()}}>چاپ / ذخیره PDF</button></div>
  <article className="a4-voucher">
   <header className="print-head"><div className="org-name">{org?.name||'بازرگانی دربندی'}</div><div className="doc-title">سند حسابداری هزینه پروانه قطعی</div><div className="doc-no">شماره سند <strong dir="ltr">{v.voucher_number}</strong></div></header>
   <div className="client-line">
    <span><b>صاحب کالا:</b> {v.company_name||v.clients?.name||'—'}</span>
    <span><b>نوع کالا:</b> {v.cargo_type||v.cases?.cargo_description||'—'}</span>
    <span><b>تناژ:</b> {v.tonnage==null?'—':Number(v.tonnage).toFixed(3)} تن</span>
    <span><b>تعداد:</b> {v.unit_count??'—'} {v.unit_type||''}</span>
    <span><b>تاریخ ورود:</b> {isoToJalali(v.cargo_entry_date)||'—'}</span>
    <span><b>تاریخ صدور پروانه:</b> {isoToJalali(v.permit_issue_date)||'—'}</span>
   </div>
   <table className="print-lines"><thead><tr><th className="row-col">ردیف</th><th>شرح</th><th className="receipt-col">شماره فیش</th><th className="amount-col">بدهکار / ریال</th><th className="amount-col">بستانکار / ریال</th></tr></thead>
   <tbody>{lines.map(x=><tr key={x.id} className={x.status==='voided'?'void-row':''}><td className="center">{x.row_number}</td><td>{x.description}{x.status==='voided'&&x.void_reason?<span className="void-note">باطل: {x.void_reason}</span>:null}</td><td dir="ltr">{x.receipt_number||''}</td><td dir="ltr">{Number(x.debit_amount)>0?money(x.debit_amount):''}</td><td dir="ltr">{Number(x.credit_amount)>0?money(x.credit_amount):''}</td></tr>)}</tbody>
   <tfoot><tr><td colSpan={3} className="total-label">جمع بدهکار / بستانکار</td><td dir="ltr">{money(v.debit_total)} ریال</td><td dir="ltr">{money(v.credit_total)} ریال</td></tr></tfoot>
   </table>
   <div className={'balance-line '+(balanced?'balanced':'unbalanced')}><span><b>جمع کل / مانده سند:</b> {money(balance)} ریال</span><strong>{balanced?'Balanced · سند متعادل':'Unbalanced · سند نامتعادل'}</strong></div>
   <footer><span>تنظیم‌کننده / امضاء</span><span>مهر و امضاء</span></footer>
  </article>
 </main>;
};