import React,{useState}from'react';
import{MoreHorizontal,Phone,Plus,UserPlus,Users}from'lucide-react';
import type{ChatConversation}from'./types';
import{supabase}from'../../lib/supabase';
import type{UserRole}from'../../context/AuthContext';

export type ChatDirectoryMode='calls'|'members';

type Person={id:string;full_name:string;phone:string|null;role:string};

type QuickNavProps={
 people:Person[];
 conversations:ChatConversation[];
 role:UserRole|null|undefined;
 onNewMessage:()=>void;
 selectedFolder:'all'|'groups'|'owners';
 onSelectFolder:(folder:'groups'|'owners')=>void;
 onOpenDirectory:(mode:ChatDirectoryMode)=>void;
 onOpenAi:()=>void;
 onOpenSettings:()=>void;
};

export const ChatQuickNav:React.FC<QuickNavProps>=({people,role,onNewMessage,onOpenDirectory,onOpenAi,onOpenSettings})=>{
 const [moreOpen,setMoreOpen]=useState(false);
 const canManageDirectory=role!=='client';
 const act=(callback:()=>void)=>{callback();setMoreOpen(false);};
 return <div className="chat-quick-nav relative" role="toolbar" aria-label="دسترسی سریع چت">
  <button type="button" className="chat-quick-nav-item" onClick={onNewMessage} title="پیام جدید"><Plus size={16}/><span>پیام جدید</span></button>
  <button type="button" className={"chat-quick-nav-item "+(moreOpen?'is-active':'')} onClick={()=>setMoreOpen(value=>!value)} aria-expanded={moreOpen} aria-label="گزینه‌های بیشتر چت"><MoreHorizontal size={17}/><span>بیشتر</span></button>
  {moreOpen&&<div className="absolute top-full left-0 z-50 mt-2 min-w-48 rounded-2xl border app-border bg-[var(--surface)] p-2 shadow-xl" role="menu">
   <button type="button" role="menuitem" className="w-full min-h-11 rounded-xl px-3 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5" onClick={()=>act(()=>onOpenDirectory('calls'))}><Phone size={16}/><span>تماس‌ها</span></button>
   {canManageDirectory&&<button type="button" role="menuitem" className="w-full min-h-11 rounded-xl px-3 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5" onClick={()=>act(()=>onOpenDirectory('members'))}><UserPlus size={16}/><span>اعضای داخلی</span><span className="mr-auto text-xs app-muted">{people.length}</span></button>}
   <button type="button" role="menuitem" className="w-full min-h-11 rounded-xl px-3 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5" onClick={()=>act(onOpenAi)}><Users size={16}/><span>دستیار هوش مصنوعی</span></button>
   <button type="button" role="menuitem" className="w-full min-h-11 rounded-xl px-3 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5" onClick={()=>act(onOpenSettings)}><MoreHorizontal size={16}/><span>تنظیمات چت</span></button>
  </div>}
 </div>;
};

type CallRow={id:string;conversation_id:string;caller_id:string;callee_id:string;status:string;created_at:string;answered_at:string|null;ended_at:string|null};

type DirectoryProps={
 open:boolean;
 mode:ChatDirectoryMode;
 organizationId?:string|null;
 currentUserId?:string|null;
 people:Person[];
 onClose:()=>void;
 onSelectConversation:(id:string)=>void;
 onNewMessage:()=>void;
 onStartDirect:(userId:string)=>void;
};

const roleLabel=(role:string)=>({owner:'مالک',admin:'مدیر',broker:'کارگزار',accountant:'حسابدار',warehouse:'انبار',client:'صاحب کالا'}as Record<string,string>)[role]||role||'کاربر';

export const ChatDirectoryPanel:React.FC<DirectoryProps>=({
 open,mode,organizationId,currentUserId,people,onClose,onSelectConversation,onNewMessage,onStartDirect,
})=>{
 const[calls,setCalls]=React.useState<CallRow[]>([]);
 const[query,setQuery]=React.useState('');
 const[loading,setLoading]=React.useState(false);
 const personMap=useMemo(()=>new Map(people.map(p=>[p.id,p])),[people]);

 React.useEffect(()=>{
  if(!open)return;
  setQuery('');
  if(mode!=='calls'||!organizationId){setLoading(false);return;}
  setLoading(true);
  void(async()=>{
   try{
    const{data,error}=await supabase
      .from('chat_voice_calls')
      .select('id,conversation_id,caller_id,callee_id,status,created_at,answered_at,ended_at')
      .eq('organization_id',organizationId)
      .order('created_at',{ascending:false})
      .limit(60);
    if(error)throw error;
    setCalls((data??[])as CallRow[]);
   }catch{setCalls([])}finally{setLoading(false)}
  })();
 },[open,mode,organizationId]);

 if(!open)return null;
 const q=query.trim().toLocaleLowerCase('fa-IR');
 const members=people.filter(p=>!q||((p.full_name||'')+' '+(p.phone??'')+' '+roleLabel(p.role)).toLocaleLowerCase('fa-IR').includes(q));
 const callName=(id:string)=>id===currentUserId?'خودم':personMap.get(id)?.full_name||'کاربر شرکت';
 const callLabel=(status:string)=>status==='missed'?'بی‌پاسخ':status==='rejected'?'رد شده':status==='cancelled'?'لغو شده':status==='ringing'?'در حال تماس':status==='active'?'تماس فعال':'تماس';
 const title=mode==='calls'?'تماس‌ها':'اعضای داخلی شرکت';
 const subtitle=mode==='calls'?'تاریخچه تماس‌های صوتی همین حساب':'کاربران فعال مجاز برای این حساب';

 return <div className="fixed inset-0 z-[700] bg-black/45 backdrop-blur-[2px] flex items-end md:items-center justify-center" onClick={onClose}>
  <section className="w-full md:w-[620px] md:max-h-[82dvh] max-h-[92dvh] rounded-t-3xl md:rounded-3xl border app-border bg-[var(--surface)] shadow-2xl overflow-hidden" onClick={e=>e.stopPropagation()} dir="rtl">
   <header className="px-4 py-3 border-b app-border flex items-center gap-3">
    <div className="h-11 w-11 rounded-2xl bg-[var(--primary)] text-white flex items-center justify-center">{mode==='calls'?<Phone size={18}/>:<UserPlus size={18}/>}</div>
    <div className="min-w-0 flex-1"><b className="block text-[16px]">{title}</b><span className="block text-[11px] app-muted mt-0.5 truncate">{subtitle}</span></div>
    <button type="button" className="h-10 w-10 rounded-full grid place-items-center hover:bg-black/5" onClick={onClose} aria-label="بستن">×</button>
   </header>
   <div className="px-4 py-3 border-b app-border"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="جست‌وجو در این فهرست…" className="h-11 bg-black/5 dark:bg-white/10 rounded-xl px-3 outline-none w-full text-sm"/></div>
   <div className="overflow-y-auto max-h-[calc(92dvh-126px)] md:max-h-[calc(82dvh-126px)] p-2">
    {loading&&<div className="p-8 text-center text-sm app-muted">در حال دریافت اطلاعات…</div>}
    {!loading&&mode==='members'&&(members.length?<div className="space-y-1">{members.map(p=><button type="button" key={p.id} onClick={()=>{onStartDirect(p.id);onClose()}} className="w-full rounded-2xl px-3 py-3 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5"><div className="h-11 w-11 shrink-0 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center font-bold">{(p.full_name||'?').slice(0,1)}</div><div className="min-w-0 flex-1"><b className="block truncate text-[13px]">{p.full_name||'کاربر'}</b><div className="text-[10px] app-muted mt-1">{roleLabel(p.role)}{p.phone?' • '+p.phone:''}</div></div></button>)}</div>:<div className="p-8 text-center text-sm app-muted">عضو فعالی پیدا نشد.</div>)}
    {!loading&&mode==='calls'&&(calls.filter(c=>!q||(callName(c.caller_id)+' '+callName(c.callee_id)+' '+callLabel(c.status)).toLocaleLowerCase('fa-IR').includes(q)).length?<div className="space-y-1">{calls.filter(c=>!q||(callName(c.caller_id)+' '+callName(c.callee_id)+' '+callLabel(c.status)).toLocaleLowerCase('fa-IR').includes(q)).map(call=>{const mine=call.caller_id===currentUserId;const other=mine?call.callee_id:call.caller_id;return <button type="button" key={call.id} onClick={()=>{onSelectConversation(call.conversation_id);onClose()}} className="w-full rounded-2xl px-3 py-3 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5"><div className="h-11 w-11 shrink-0 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] grid place-items-center"><Phone size={17}/></div><div className="min-w-0 flex-1"><b className="block truncate text-[13px]">{callName(other)}</b><div className="text-[10px] app-muted mt-1">{callLabel(call.status)} • {new Intl.DateTimeFormat('fa-IR-u-ca-persian',{timeZone:'Asia/Tehran',dateStyle:'medium',timeStyle:'short'}).format(new Date(call.created_at))}</div></div></button>})}</div>:<div className="p-8 text-center text-sm app-muted">هنوز سابقه تماسی ثبت نشده است.</div>)}
   </div>
   {mode==='members'&&<footer className="border-t app-border p-3"><button type="button" className="w-full min-h-11 rounded-xl border app-border text-sm font-bold" onClick={onNewMessage}><Plus size={14} className="inline ml-1"/>شروع پیام جدید</button></footer>}
  </section>
 </div>;
};
