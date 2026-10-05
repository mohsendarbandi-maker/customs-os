import React,{useEffect,useMemo,useState}from'react';
import{ChevronDown,ChevronLeft,Hash,Phone,Plus,Settings,UserPlus,Users,UserRound,Bot,Volume2,VolumeX,X}from'lucide-react';
import{supabase}from'../../lib/supabase';
import{listChatHierarchy,type ChatHierarchyItem}from'./api';
import type{ChatConversation}from'./types';

export type ChatDirectoryMode='groups'|'owners'|'calls'|'members';
type Person={id:string;full_name:string;phone:string|null;role:string};
type QuickNavProps={
 people:Person[];
 conversations:ChatConversation[];
 onNewMessage:()=>void;
 onOpenDirectory:(mode:ChatDirectoryMode)=>void;
 onOpenAi:()=>void;
 onOpenSettings:()=>void;
};

const roleLabel=(role:string)=>({owner:'مالک',admin:'مدیر',broker:'کارگزار',accountant:'حسابدار',warehouse:'انبار',client:'صاحب کالا'}as Record<string,string>)[role]||role||'کاربر';

export const ChatQuickNav:React.FC<QuickNavProps>=({people,conversations,onNewMessage,onOpenDirectory,onOpenAi,onOpenSettings})=>{
 const groupCount=conversations.filter(c=>['group','company_channel','shared_company'].includes(c.type)&&!['owner_group','shipment_group'].includes(c.hierarchy_kind??'')).length;
 const ownerCount=conversations.filter(c=>c.hierarchy_kind==='owner_group').length;
 return <div className="chat-quick-nav" role="toolbar" aria-label="دسترسی سریع چت">
  <button type="button" className="chat-quick-nav-item" onClick={onNewMessage} title="پیام جدید"><Plus size={16}/><span>جدید</span></button>
  <button type="button" className="chat-quick-nav-item" onClick={()=>onOpenDirectory('groups')} title="گروه‌ها و کانال‌ها"><Users size={16}/><span>گروه‌ها</span>{groupCount>0&&<em>{groupCount}</em>}</button>
  <button type="button" className="chat-quick-nav-item" onClick={()=>onOpenDirectory('owners')} title="صاحب کالاها"><UserRound size={16}/><span>صاحب کالا</span>{ownerCount>0&&<em>{ownerCount}</em>}</button>
  <button type="button" className="chat-quick-nav-item" onClick={()=>onOpenDirectory('calls')} title="لیست تماس‌ها"><Phone size={16}/><span>تماس</span></button>
  <button type="button" className="chat-quick-nav-item" onClick={()=>onOpenDirectory('members')} title="اعضای داخلی شرکت"><UserPlus size={16}/><span>اعضا</span>{people.length>0&&<em>{people.length}</em>}</button>
  <button type="button" className="chat-quick-nav-item" onClick={onOpenAi} title="هوش مصنوعی"><Bot size={16}/><span>AI</span></button>
  <button type="button" className="chat-quick-nav-item" onClick={onOpenSettings} title="تنظیمات"><Settings size={16}/><span>تنظیمات</span></button>
 </div>;
};

type DirectoryProps={
 open:boolean;
 mode:ChatDirectoryMode;
 organizationId?:string|null;
 people:Person[];
 conversations:ChatConversation[];
 onClose:()=>void;
 onSelectConversation:(id:string)=>void;
 onNewMessage:()=>void;
 onStartDirect:(userId:string)=>void;
 onCreateGroup:()=>void;
 embedded?:boolean;
};

type CallRow={id:string;conversation_id:string;caller_id:string;callee_id:string;status:string;created_at:string;answered_at:string|null;ended_at:string|null};

export const ChatDirectoryPanel:React.FC<DirectoryProps>=({open,mode,organizationId,people,conversations,onClose,onSelectConversation,onNewMessage,onStartDirect,onCreateGroup,embedded=false})=>{
 const[hierarchy,setHierarchy]=useState<ChatHierarchyItem[]>([]);
 const[expanded,setExpanded]=useState<Record<string,boolean>>({});
 const[calls,setCalls]=useState<CallRow[]>([]);
 const[query,setQuery]=useState('');
 const[loading,setLoading]=useState(false);
 const personMap=useMemo(()=>new Map(people.map(p=>[p.id,p])),[people]);

 useEffect(()=>{
  if(!open)return;
  setQuery('');
  if(mode==='owners'){
   setLoading(true);
   void listChatHierarchy().then(items=>{
    setHierarchy(items);
    setExpanded(prev=>{
     const next={...prev};
     items.filter(x=>x.hierarchy_kind==='owner_group').forEach(x=>{if(next[x.conversation_id]===undefined)next[x.conversation_id]=true});
     return next;
    });
   }).catch(()=>setHierarchy([])).finally(()=>setLoading(false));
  }else if(mode==='calls'&&organizationId){
   setLoading(true);
   void (async()=>{
    try{
     const{data}=await supabase.from('chat_voice_calls').select('id,conversation_id,caller_id,callee_id,status,created_at,answered_at,ended_at').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(60);
     setCalls((data??[])as CallRow[]);
    }catch{
     setCalls([]);
    }finally{
     setLoading(false);
    }
   })();
  }else{
   setLoading(false);
  }
 },[open,mode,organizationId]);

 if(!open)return null;
 const q=query.trim().toLocaleLowerCase('fa-IR');
 const groups=conversations.filter(c=>['group','company_channel','shared_company'].includes(c.type)&&!['owner_group','shipment_group'].includes(c.hierarchy_kind??'')).filter(c=>!q||((c.title??'')+' '+(c.display_name??'')).toLocaleLowerCase('fa-IR').includes(q));
 const owners=hierarchy.filter(x=>x.hierarchy_kind==='owner_group');
 const children=new Map<string,ChatHierarchyItem[]>();
 hierarchy.forEach(item=>{if(item.hierarchy_kind==='shipment_group'&&item.parent_conversation_id){const list=children.get(item.parent_conversation_id)??[];list.push(item);children.set(item.parent_conversation_id,list)}});
 const members=people.filter(p=>!q||((p.full_name||'')+' '+(p.phone??'')+' '+roleLabel(p.role)).toLocaleLowerCase('fa-IR').includes(q));
 const callName=(id:string)=>personMap.get(id)?.full_name||'کاربر شرکت';
 const callLabel=(status:string)=>status==='missed'?'بی‌پاسخ':status==='rejected'?'رد شده':status==='cancelled'?'لغو شده':status==='ringing'?'در حال تماس':'تماس';
 const title=mode==='groups'?'گروه‌ها و کانال‌ها':mode==='owners'?'صاحب کالاها':mode==='calls'?'تماس‌ها':'اعضای داخلی شرکت';
 const subtitle=mode==='groups'?'گروه، کانال و گفتگوی سازمانی':mode==='owners'?'صاحب کالا ← محموله‌ها':mode==='calls'?'تاریخچه تماس‌های صوتی':'کاربران فعال همین سازمان';
 return <div className={embedded?"chat-directory-embedded":"fixed inset-0 z-[700] bg-black/45 backdrop-blur-[2px] flex items-end md:items-center justify-center"} onClick={onClose}>
  <section className={(embedded?"chat-directory-panel w-full h-full min-h-0 border-0 rounded-none":"chat-directory-panel w-full md:w-[620px] md:max-h-[82dvh] max-h-[92dvh] rounded-t-3xl md:rounded-3xl border app-border")+" bg-[var(--surface)] shadow-2xl overflow-hidden"} onClick={e=>e.stopPropagation()} dir="rtl">
   <header className="px-4 py-3 border-b app-border flex items-center gap-3">
    <div className="h-11 w-11 rounded-2xl bg-[var(--primary)] text-white flex items-center justify-center">{mode==='calls'?<Phone size={18}/>:mode==='members'?<UserPlus size={18}/>:mode==='owners'?<UserRound size={18}/>:<Users size={18}/>}</div>
    <div className="min-w-0 flex-1"><b className="block text-[16px]">{title}</b><span className="block text-[11px] app-muted mt-0.5 truncate">{subtitle}</span></div>
    {mode==='groups'&&<button type="button" className="h-10 px-3 rounded-xl bg-[var(--primary)] text-white text-xs font-bold" onClick={onCreateGroup}><Plus size={14} className="inline ml-1"/>گروه جدید</button>}
    <button type="button" className="h-10 w-10 rounded-full grid place-items-center hover:bg-black/5" onClick={onClose} aria-label="بستن"><X size={18}/></button>
   </header>
   <div className="px-4 py-3 border-b app-border"><div className="h-11 rounded-xl bg-black/5 dark:bg-white/10 px-3 flex items-center"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="جست‌وجو در این فهرست…" className="bg-transparent outline-none w-full text-sm"/></div></div>
   <div className="overflow-y-auto max-h-[calc(92dvh-126px)] md:max-h-[calc(82dvh-126px)] p-2">
    {loading&&<div className="p-8 text-center text-sm app-muted">در حال دریافت اطلاعات…</div>}
    {!loading&&mode==='groups'&&(groups.length?<div className="space-y-1">{groups.map(c=><button type="button" key={c.conversation_id} onClick={()=>{onSelectConversation(c.conversation_id);onClose()}} className="w-full rounded-2xl px-3 py-3 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5">
      <div className="h-11 w-11 shrink-0 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center"><Users size={18}/></div>
      <div className="min-w-0 flex-1"><b className="block truncate text-[13px]">{c.title||c.display_name||'گروه'}</b><div className="text-[10px] app-muted mt-1">{c.type==='company_channel'?'کانال سازمان':c.type==='shared_company'?'گفتگوی مشترک شرکت‌ها':'گروه'}</div></div>
      {c.unread_count>0&&<span className="min-w-6 h-6 rounded-full bg-[var(--primary)] text-white text-[10px] flex items-center justify-center">{c.unread_count}</span>}
    </button>)}</div>:<div className="p-8 text-center text-sm app-muted">گروه یا کانالی پیدا نشد.</div>)}
    {!loading&&mode==='owners'&&(owners.length?<div className="space-y-2">{owners.map(owner=>{const child=children.get(owner.conversation_id)??[];const isOpen=expanded[owner.conversation_id]??true;return <div key={owner.conversation_id} className="rounded-2xl border app-border overflow-hidden">
      <div className="flex items-center gap-1"><button type="button" className="h-12 w-10 grid place-items-center" onClick={()=>setExpanded(prev=>({...prev,[owner.conversation_id]:!isOpen}))}>{isOpen?<ChevronDown size={16}/>:<ChevronLeft size={16}/>}</button>
      <button type="button" className="flex-1 min-w-0 text-right px-2 py-3 flex items-center gap-3" onClick={()=>{onSelectConversation(owner.conversation_id);onClose()}}><div className="h-11 w-11 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] grid place-items-center"><UserRound size={18}/></div><span className="min-w-0 flex-1"><b className="block truncate text-[13px]">{owner.title||'صاحب کالا'}</b><span className="text-[10px] app-muted">{child.length} محموله</span></span></button></div>
      {isOpen&&child.length>0&&<div className="mr-5 pr-2 pb-2 border-r app-border">{child.map(shipment=><button key={shipment.conversation_id} type="button" onClick={()=>{onSelectConversation(shipment.conversation_id);onClose()}} className="w-full rounded-xl px-3 py-2.5 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5"><div className="h-9 w-9 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] grid place-items-center"><Hash size={15}/></div><span className="min-w-0 flex-1"><b className="block truncate text-[12px]">{shipment.shipment_display_name||shipment.title||'محموله'}</b><span className="text-[10px] app-muted">{shipment.shipment_bl_number||'بدون شماره بارنامه'}</span></span></button>)}</div>}
     </div>})}</div>:<div className="p-8 text-center text-sm app-muted">هنوز صاحب کالایی در ساختار چت ثبت نشده است.</div>)}
    {!loading&&mode==='members'&&(members.length?<div className="space-y-1">{members.map(p=><button type="button" key={p.id} onClick={()=>{onStartDirect(p.id);onClose()}} className="w-full rounded-2xl px-3 py-3 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5"><div className="h-11 w-11 shrink-0 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center font-bold">{(p.full_name||'?').slice(0,1)}</div><div className="min-w-0 flex-1"><b className="block truncate text-[13px]">{p.full_name||'کاربر'}</b><div className="text-[10px] app-muted mt-1">{roleLabel(p.role)}{p.phone?' • '+p.phone:''}</div></div></button>)}</div>:<div className="p-8 text-center text-sm app-muted">عضو فعالی پیدا نشد.</div>)}
    {!loading&&mode==='calls'&&(calls.length?<div className="space-y-1">{calls.filter(c=>!q||(callName(c.caller_id)+' '+callName(c.callee_id)+' '+callLabel(c.status)).toLocaleLowerCase('fa-IR').includes(q)).map(call=>{const mine=people.some(p=>p.id===call.caller_id);const other=mine?call.callee_id:call.caller_id;return <button type="button" key={call.id} onClick={()=>{onSelectConversation(call.conversation_id);onClose()}} className="w-full rounded-2xl px-3 py-3 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5"><div className="h-11 w-11 shrink-0 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] grid place-items-center"><Phone size={17}/></div><div className="min-w-0 flex-1"><b className="block truncate text-[13px]">{callName(other)}</b><div className="text-[10px] app-muted mt-1">{callLabel(call.status)} • {new Intl.DateTimeFormat('fa-IR-u-ca-persian',{timeZone:'Asia/Tehran',dateStyle:'medium',timeStyle:'short'}).format(new Date(call.created_at))}</div></div>{call.status==='missed'?<VolumeX size={15} className="text-red-500"/>:<Volume2 size={15} className="text-[var(--primary)]"/>}</button>})}</div>:<div className="p-8 text-center text-sm app-muted">هنوز سابقه تماسی ثبت نشده است.</div>)}
   </div>
   {mode==='members'&&<footer className="border-t app-border p-3"><button type="button" className="w-full min-h-11 rounded-xl border app-border text-sm font-bold" onClick={onNewMessage}><Plus size={14} className="inline ml-1"/>شروع پیام جدید</button></footer>}
  </section>
 </div>;
};
