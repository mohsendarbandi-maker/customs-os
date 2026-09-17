export type CaseAlertLevel='urgent'|'warning'|'info';
export type CaseAlert={id:string;caseId:string;caseNumber:string;title:string;detail:string;level:CaseAlertLevel;href:string};
export type AlertCase={id:string;case_number:string|null;status:string;valuation_status:string|null;release_status:string|null};
export type AlertDoc={case_id:string|null;document_type:string|null;status:string|null};
export type AlertDeclaration={case_id:string|null;kottaj_number:string|null;customs_path:string|null;created_at?:string|null};
export type AlertPermit={case_id:string|null;status:string|null};
const required=[['PROFORMA_INVOICE','پروفورما'],['COMMERCIAL_INVOICE','کامرشال اینویس'],['PACKING_LIST','پکینگ لیست'],['BILL_OF_LADING','B/L'],['CERTIFICATE_OF_ORIGIN','گواهی مبدأ']] as const;
export function buildCaseAlerts(cases:AlertCase[],docs:AlertDoc[],decls:AlertDeclaration[],permits:AlertPermit[]):CaseAlert[]{
 const out:CaseAlert[]=[];
 for(const c of cases){const num=c.case_number||c.id.slice(0,8);const ds=docs.filter(d=>d.case_id===c.id);const approved=new Set(ds.filter(d=>d.status==='approved').map(d=>String(d.document_type||'').toUpperCase()));const missing=required.filter(([t])=>!approved.has(t)).map(([,n])=>n);const d=decls.filter(x=>x.case_id===c.id).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0];const pending=permits.filter(p=>p.case_id===c.id&&p.status==='pending').length;const q=encodeURIComponent(c.id);
  if(missing.length&&['draft','registration_order','documents_ready'].includes(c.status))out.push({id:`${c.id}-docs`,caseId:c.id,caseNumber:num,title:'نقص اسناد پایه',detail:`${missing.join('، ')} تأیید نشده است.`,level:'warning',href:`/documents?caseId=${q}`});
  if(c.status==='epl_submitted'&&!d?.kottaj_number)out.push({id:`${c.id}-kottaj`,caseId:c.id,caseNumber:num,title:'کوتاژ ثبت نشده',detail:'اظهار ثبت شده اما شماره کوتاژ هنوز ثبت نشده است.',level:'urgent',href:`/operations?tab=declaration&caseId=${q}`});
  if(c.status==='kottaj_received'&&!d?.customs_path)out.push({id:`${c.id}-path`,caseId:c.id,caseNumber:num,title:'مسیر گمرکی مشخص نشده',detail:'پرونده کوتاژ دارد اما مسیر گمرکی ثبت نشده است.',level:'warning',href:`/stage?caseId=${q}`});
  if(['path_green','path_yellow','path_red','valuation'].includes(c.status)&&c.valuation_status!=='calculated')out.push({id:`${c.id}-valuation`,caseId:c.id,caseNumber:num,title:'ارزش‌گذاری در انتظار اقدام',detail:'پرونده به مرحله ارزش‌گذاری رسیده ولی وضعیت محاسبه کامل نیست.',level:'warning',href:`/operations?tab=valuation&caseId=${q}`});
  if(c.status==='duties_calculation')out.push({id:`${c.id}-duties`,caseId:c.id,caseNumber:num,title:'اقدام حقوق و عوارض',detail:'پرونده در مرحله محاسبه حقوق و عوارض است.',level:'info',href:`/operations?tab=duties&caseId=${q}`});
  if(c.status==='exit_permit'&&c.release_status!=='released')out.push({id:`${c.id}-release`,caseId:c.id,caseNumber:num,title:'آزادسازی/خروج در انتظار',detail:'پرونده به مرحله خروج رسیده اما وضعیت آزادسازی کامل نشده است.',level:'urgent',href:`/operations?tab=exit&caseId=${q}`});
  if(pending)out.push({id:`${c.id}-permits`,caseId:c.id,caseNumber:num,title:'مجوز در انتظار',detail:`${pending} مجوز با وضعیت در انتظار وجود دارد.`,level:'warning',href:`/operations?tab=case&caseId=${q}`});
 }
 return out;
}
export const alertCounts=(alerts:CaseAlert[])=>({total:alerts.length,urgent:alerts.filter(a=>a.level==='urgent').length,warning:alerts.filter(a=>a.level==='warning').length,info:alerts.filter(a=>a.level==='info').length});
