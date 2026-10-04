import React,{useEffect,useState}from'react';
import{ArrowRight,Check,Copy,Link2,RefreshCw,X}from'lucide-react';
import{Link}from'react-router-dom';
import{useAuth}from'../context/AuthContext';
import{acceptOrgConnection,cancelOrgConnection,createOrgConnection,listOrgConnections}from'../features/chat/api';

type Connection={id:string;source_organization_id:string;target_organization_id:string;relationship_type:string;status:string;requested_by:string;accepted_by:string|null;created_at:string;updated_at:string;source_name:string;target_name:string};

const typeLabel:Record<string,string>={business_partner:'شریک تجاری',shipping_partner:'شریک حمل',customs_agent:'همکار گمرکی',client_partner:'همکار / صاحب کالا'};
const statusLabel:Record<string,string>={pending:'در انتظار پذیرش',accepted:'متصل',suspended:'معلق',cancelled:'لغوشده'};

export const OrgConnectionsPage:React.FC=()=>{
 const{profile}=useAuth();
 const[rows,setRows]=useState<Connection[]>([]);
 const[targetId,setTargetId]=useState('');
 const[relationship,setRelationship]=useState('business_partner');
 const[loading,setLoading]=useState(true);
 const[busy,setBusy]=useState(false);
 const[message,setMessage]=useState('');

 const load=async()=>{setLoading(true);try{setRows(await listOrgConnections());setMessage('')}catch(e){setMessage(e instanceof Error?e.message:'دریافت اتصال‌ها ناموفق بود')}finally{setLoading(false)}};
 useEffect(()=>{void load()},[]);

 const create=async()=>{const id=targetId.trim();if(!id){setMessage('شناسه سازمان مقصد را وارد کنید.');return}setBusy(true);try{await createOrgConnection(id,relationship);setTargetId('');setMessage('درخواست اتصال ارسال شد.');await load()}catch(e){setMessage(e instanceof Error?e.message:'ایجاد درخواست اتصال ناموفق بود')}finally{setBusy(false)}};
 const accept=async(id:string)=>{setBusy(true);try{await acceptOrgConnection(id);setMessage('اتصال پذیرفته شد.');await load()}catch(e){setMessage(e instanceof Error?e.message:'پذیرش اتصال ناموفق بود')}finally{setBusy(false)}};
 const cancel=async(id:string)=>{setBusy(true);try{await cancelOrgConnection(id);setMessage('اتصال لغو/قطع شد.');await load()}catch(e){setMessage(e instanceof Error?e.message:'قطع اتصال ناموفق بود')}finally{setBusy(false)}};
 const copyOwn=async()=>{if(!profile?.organization_id)return;try{await navigator.clipboard?.writeText(profile.organization_id);setMessage('شناسه سازمان کپی شد.')}catch{setMessage(profile.organization_id)}};

 return <main dir="rtl" className="min-h-screen p-4 md:p-8" style={{background:'var(--bg)',color:'var(--text)'}}><div className="max-w-5xl mx-auto space-y-5">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] app-muted">ارتباط بین شرکت‌ها</div><h1 className="text-2xl font-black mt-1">اتصال سازمان‌ها</h1><p className="text-sm app-muted mt-1">برای کانال مشترک، ابتدا دو سازمان با رضایت مدیران به یکدیگر متصل می‌شوند.</p></div><Link to="/chat" className="rounded-xl border app-border bg-[var(--surface)] px-4 py-2 text-sm font-bold"><ArrowRight className="inline ml-1" size={15}/>بازگشت به Chat</Link></header>
  {message&&<div className="rounded-xl border app-border bg-[var(--surface)] p-3 text-sm">{message}</div>}
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-4 md:p-5 space-y-3"><div className="font-black">شناسه سازمان شما</div><div className="flex flex-col sm:flex-row gap-2"><code dir="ltr" className="flex-1 rounded-xl border app-border bg-[var(--surface-2)] px-3 py-3 text-xs break-all">{profile?.organization_id||'—'}</code><button onClick={()=>void copyOwn()} className="rounded-xl border app-border px-4 py-3 text-xs font-bold"><Copy size={15} className="inline ml-1"/>کپی</button></div><p className="text-[10px] app-muted">این شناسه را فقط با مدیر شرکت مقصدی که می‌خواهید با آن ارتباط داشته باشید به اشتراک بگذارید.</p></section>
  <section className="rounded-2xl border app-border bg-[var(--surface)] p-4 md:p-5"><div className="font-black mb-3">درخواست اتصال جدید</div><div className="grid md:grid-cols-[1fr_220px_auto] gap-2"><input value={targetId} onChange={e=>setTargetId(e.target.value)} placeholder="UUID سازمان مقصد" dir="ltr" className="min-h-11 rounded-xl border app-border bg-transparent px-3 text-sm"/><select value={relationship} onChange={e=>setRelationship(e.target.value)} className="min-h-11 rounded-xl border app-border bg-transparent px-3 text-sm"><option value="business_partner">شریک تجاری</option><option value="shipping_partner">شریک حمل</option><option value="customs_agent">همکار گمرکی</option><option value="client_partner">همکار / صاحب کالا</option></select><button disabled={busy||!targetId.trim()} onClick={()=>void create()} className="min-h-11 rounded-xl bg-[var(--primary)] text-white px-5 text-xs font-bold disabled:opacity-40"><Link2 size={15} className="inline ml-1"/>ارسال</button></div></section>
  <section className="rounded-2xl border app-border bg-[var(--surface)] overflow-hidden"><div className="p-4 border-b app-border flex items-center justify-between"><b>اتصال‌ها</b><button className="icon-btn" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/></button></div>{loading?<div className="p-10 text-center app-muted">در حال دریافت…</div>:rows.length===0?<div className="p-10 text-center app-muted">هنوز اتصال سازمانی ثبت نشده است.</div>:<div className="divide-y app-border">{rows.map(row=>{const incoming=row.target_organization_id===profile?.organization_id;const other=incoming?row.source_name:row.target_name;return <div key={row.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3"><div className="flex-1 min-w-0"><div className="font-bold">{other||'سازمان مقابل'}</div><div className="text-[10px] app-muted mt-1">{typeLabel[row.relationship_type]||row.relationship_type} · {statusLabel[row.status]||row.status}</div><div className="text-[9px] app-muted mt-1 break-all" dir="ltr">{incoming?row.source_organization_id:row.target_organization_id}</div></div><div className="flex gap-2">{row.status==='pending'&&incoming&&<button disabled={busy} onClick={()=>void accept(row.id)} className="rounded-xl bg-[var(--primary)] text-white px-4 py-2 text-xs font-bold"><Check size={14} className="inline ml-1"/>پذیرش</button>}{(row.status==='pending'||row.status==='accepted')&&<button disabled={busy} onClick={()=>void cancel(row.id)} className="rounded-xl border app-border px-4 py-2 text-xs font-bold"><X size={14} className="inline ml-1"/>لغو / قطع</button>}</div></div>})}</div>}</section>
 </div></main>;
};