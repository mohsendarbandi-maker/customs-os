import React,{useState} from 'react';
import {Bell,CalendarDays,Plus,X} from 'lucide-react';
import {useAuth} from '../../context/AuthContext';
import {supabase} from '../../lib/supabase';
import {parseReminder,type ReminderKind,resolveAssignee,resolveLink} from './reminderCore';
import {JalaliDateTimePicker} from './JalaliDateTimePicker';
import {formatJalaliDateTime,zonedJalaliToDate,toJalali} from '../../lib/jalali';

type Props={entityType:'customs_documents'|'shipment_documents'|'documents'|'shipments'|'cases'|'finance_invoices'|'clients';entityId:string;defaultTitle:string};
export const AddReminderButton:React.FC<Props>=({entityType,entityId,defaultTitle})=>{
 const {user,profile}=useAuth();const [open,setOpen]=useState(false);const [title,setTitle]=useState(defaultTitle);const [due,setDue]=useState(()=>new Date(Date.now()+3600000));const [picker,setPicker]=useState(false);const [saving,setSaving]=useState(false);
 const save=async()=>{if(!user||!profile||!title.trim())return;setSaving(true);try{
  const kind:ReminderKind=entityType==='customs_documents'||entityType==='shipment_documents'||entityType==='documents'?'document':entityType==='finance_invoices'?'finance':entityType==='shipments'?'shipment':'other';
  const uuid=crypto.randomUUID();const parsed=parseReminder(title,due);parsed.dueAt=due;parsed.kind=kind;
  const {data,error}=await supabase.rpc('create_operational_reminder',{p_payload:{title:parsed.title,due_at:due.toISOString(),priority:parsed.priority,kind,entity_type:entityType,entity_id:entityId,assignee_id:user.id,visibility:'private',all_day:false,timezone:'Asia/Tehran',alarm_offsets_min:[0],client_uuid:uuid}}) as {data:Reminder|null;error:{message:string}|null};
  if(error)throw new Error(error.message);
  if(data){void resolveLink(parsed.linkQuery,kind);void resolveAssignee(parsed.assigneeName);}
  setOpen(false);
 }catch(e){alert(e instanceof Error?e.message:'ثبت یادآور انجام نشد')}finally{setSaving(false);}
 };
 return <><button onClick={()=>setOpen(true)} className="min-h-11 min-w-11 rounded-xl border app-border bg-[var(--surface-2)] inline-flex items-center justify-center" aria-label="افزودن یادآور"><Bell size={16}/></button>
 {open&&<div className="fixed inset-0 z-[180] bg-black/55 flex items-end md:items-center justify-center" dir="rtl"><div className="w-full md:max-w-md rounded-t-[28px] md:rounded-[28px] border app-border bg-[var(--surface)] p-4 pb-[calc(18px+env(safe-area-inset-bottom))]"><div className="flex justify-between items-center mb-3"><b>افزودن یادآور</b><button onClick={()=>setOpen(false)} className="min-w-11 min-h-11 border app-border rounded-xl"><X size={17}/></button></div><input value={title} onChange={e=>setTitle(e.target.value)} className="w-full min-h-12 rounded-xl border app-border bg-[var(--surface-2)] px-3" /><button onClick={()=>setPicker(true)} className="w-full min-h-12 mt-3 rounded-xl border app-border bg-[var(--surface-2)] px-3 flex items-center gap-2 text-right"><CalendarDays size={16}/><span className="flex-1">{formatJalaliDateTime(due)}</span><span className="text-xs app-muted">تغییر</span></button><button disabled={saving} onClick={()=>void save()} className="w-full min-h-12 mt-3 rounded-xl bg-[var(--primary)] text-white font-black flex items-center justify-center gap-2"><Plus size={16}/>{saving?'در حال ثبت…':'ثبت یادآور'}</button></div></div>}
 {picker&&<JalaliDateTimePicker value={due} onChange={setDue} allDay={false} onAllDayChange={()=>undefined} onClose={()=>setPicker(false)}/>}
 </>;
};
