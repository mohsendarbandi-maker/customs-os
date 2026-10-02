import React,{useCallback,useEffect,useMemo,useRef,useState}from'react';
import{CheckCheck,MessageCircle,MoreVertical,Plus,Search,Send,Trash2,Users,Wifi,WifiOff}from'lucide-react';
import{useAuth}from'../../context/AuthContext';
import{normalizeFaText,formatJalaliDateTime}from'../../lib/jalali';
import{makeClientId}from'../../lib/clientId';
import{createDirectConversation,deleteForAll,deleteForMe,listConversations,listMessages,markRead,searchChat,sendMessage}from'./api';
import{supabase}from'../../lib/supabase';
import type{ChatConversation,ChatMessage}from'./types';

type Person={id:string;full_name:string;phone:string|null;role:string};
type PresenceUser={user_id:string;typing?:boolean};
const err=(e:unknown)=>e instanceof Error?e.message:'عملیات چت انجام نشد. دوباره تلاش کنید.';
const title=(c:ChatConversation)=>c.title||(c.type==='direct'?'گفتگوی مستقیم':c.type==='shared_company'?'گفتگوی مشترک شرکت‌ها':c.type==='company_channel'?'کانال سازمان':'گفتگو');

export const ChatPage:React.FC=()=>{
 const{user,profile}=useAuth();
 const[conversations,setConversations]=useState<ChatConversation[]>([]);
 const[selectedId,setSelectedId]=useState<string|null>(null);
 const[messages,setMessages]=useState<ChatMessage[]>([]);
 const[text,setText]=useState('');
 const[error,setError]=useState<string|null>(null);
 const[loading,setLoading]=useState(true);
 const[sending,setSending]=useState(false);
 const[online,setOnline]=useState(()=>navigator.onLine);
 const[realtimeState,setRealtimeState]=useState<'connecting'|'subscribed'|'degraded'>('connecting');
 const[typingUsers,setTypingUsers]=useState<string[]>([]);
 const realtimeStateRef=useRef<'connecting'|'subscribed'|'degraded'>('connecting');
 const[people,setPeople]=useState<Person[]>([]);
 const[peopleOpen,setPeopleOpen]=useState(false);
 const[query,setQuery]=useState('');
 const[results,setResults]=useState<Array<{kind:string;id:string;conversation_id:string;title:string;snippet:string;created_at:string}>>([]);
 const[reply,setReply]=useState<ChatMessage|null>(null);
 const[menu,setMenu]=useState<string|null>(null);
 const bottom=useRef<HTMLDivElement|null>(null);
 const channel=useRef<ReturnType<typeof supabase.channel>|null>(null);
 const pollTimer=useRef<number|null>(null);
 const pollDelay=useRef(15000);
 const typingTimer=useRef<number|null>(null);
 const lastTypingSent=useRef(0);

 const refresh=useCallback(async()=>{
  try{const data=await listConversations();setConversations(data);if(!selectedId&&data[0])setSelectedId(data[0].conversation_id)}
  catch(e){setError(err(e))}finally{setLoading(false)}
 },[selectedId]);

 const load=useCallback(async(id:string)=>{
  try{const data=await listMessages(id);setMessages([...data].reverse());if(data[0])await markRead(id,data[0].id)}
  catch(e){setError(err(e))}
 },[]);

 const schedulePoll=useCallback((id:string,delay:number)=>{
  if(pollTimer.current!==null)window.clearTimeout(pollTimer.current);
  pollTimer.current=window.setTimeout(async()=>{
   try{await load(id);await refresh();pollDelay.current=15000}
   catch{pollDelay.current=Math.min(60000,Math.max(5000,pollDelay.current*2))}
   schedulePoll(id,pollDelay.current);
  },delay);
 },[load,refresh]);

 useEffect(()=>{
  void refresh();
  const on=()=>setOnline(true),off=()=>setOnline(false);
  window.addEventListener('online',on);window.addEventListener('offline',off);
  return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off)}
 },[refresh]);

 useEffect(()=>{
  if(!selectedId)return;
  void load(selectedId);
  if(channel.current)void supabase.removeChannel(channel.current);
  if(pollTimer.current!==null)window.clearTimeout(pollTimer.current);
  pollDelay.current=15000;
  setRealtimeState('connecting');realtimeStateRef.current='connecting';
  setTypingUsers([]);

  const ch=supabase.channel('chat:'+selectedId,{config:{private:true,presence:{key:user?.id??'anonymous'}}})
   .on('postgres_changes',{event:'*',schema:'public',table:'chat_messages',filter:'conversation_id=eq.'+selectedId},()=>{void load(selectedId);void refresh()})
   .on('postgres_changes',{event:'*',schema:'public',table:'chat_message_receipts',filter:'message_id=in.(*)'},()=>{void load(selectedId)})
   .on('postgres_changes',{event:'*',schema:'public',table:'chat_message_reactions',filter:'message_id=in.(*)'},()=>{void load(selectedId)})
   .on('postgres_changes',{event:'*',schema:'public',table:'chat_conversation_members',filter:'conversation_id=eq.'+selectedId},()=>{void refresh();void load(selectedId)})
   .on('broadcast',{event:'typing'},payload=>{
     const p=payload.payload as PresenceUser;
     if(!p?.user_id||p.user_id===user?.id)return;
     setTypingUsers(v=>p.typing?[...new Set([...v,p.user_id])]:v.filter(id=>id!==p.user_id));
   })
   .on('presence',{event:'sync'},()=>{
     const state=ch.presenceState<PresenceUser>();
     const ids=Object.values(state).flat().filter(p=>p.user_id&&p.user_id!==user?.id&&p.typing).map(p=>p.user_id);
     setTypingUsers([...new Set(ids)]);
   })
   .subscribe(async status=>{
     if(status==='SUBSCRIBED'){
       setRealtimeState('subscribed');realtimeStateRef.current='subscribed';pollDelay.current=30000;
       if(user?.id)await ch.track({user_id:user.id,typing:false,at:Date.now()});
     }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
       setRealtimeState('degraded');realtimeStateRef.current='degraded';pollDelay.current=Math.min(30000,Math.max(5000,pollDelay.current));
     }
   });
  channel.current=ch;
  schedulePoll(selectedId,5000);
  return()=>{if(pollTimer.current!==null)window.clearTimeout(pollTimer.current);void supabase.removeChannel(ch);channel.current=null}
 },[selectedId,user?.id,load,refresh,schedulePoll]);

 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'})},[messages.length,selectedId]);

 const broadcastTyping=useCallback((typing:boolean)=>{
  if(!channel.current||!user?.id)return;
  const now=Date.now();
  if(typing&&now-lastTypingSent.current<500)return;
  lastTypingSent.current=now;
  void channel.current.send({type:'broadcast',event:'typing',payload:{user_id:user.id,typing}});
  if(typing&&typingTimer.current!==null)window.clearTimeout(typingTimer.current);
  if(typing)typingTimer.current=window.setTimeout(()=>broadcastTyping(false),1200);
 },[user?.id]);

 const openPeople=async()=>{
  if(!profile?.organization_id)return;
  const{data,error:e}=await supabase.from('profiles').select('id,full_name,phone,role').eq('organization_id',profile.organization_id).eq('is_active',true).order('full_name');
  if(e){setError(err(e));return}setPeople((data??[])as Person[]);setPeopleOpen(true);
 };
 const newChat=async(id:string)=>{try{const c=await createDirectConversation(id);await refresh();setSelectedId(c.conversation_id);setPeopleOpen(false)}catch(e){setError(err(e))}};

 const send=async()=>{
  const body=normalizeFaText(text);if(!body||!selectedId||sending)return;
  setSending(true);broadcastTyping(false);
  const clientUuid=makeClientId();
  const optimistic:ChatMessage={id:'optimistic-'+clientUuid,organization_id:profile?.organization_id??'',conversation_id:selectedId,sender_id:user?.id??'',client_uuid:clientUuid,message_type:'text',body,reply_to_message_id:reply?.id??null,forwarded_from_message_id:null,thread_root_message_id:null,delivery_status:'sending',edited_at:null,deleted_at:null,deleted_for_all_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  setMessages(v=>[...v,optimistic]);setText('');setReply(null);
  try{const result=await sendMessage(selectedId,clientUuid,body,reply?.id);setMessages(v=>v.filter(m=>m.id!==optimistic.id));if('queued'in result&&result.queued)setMessages(v=>[...v,{...optimistic,delivery_status:'queued'}]);else{await load(selectedId);await refresh()}}
  catch(e){setMessages(v=>v.filter(m=>m.id!==optimistic.id));setText(body);setError(err(e))}finally{setSending(false)}
 };
 const remove=async(m:ChatMessage,all:boolean)=>{try{if(all)await deleteForAll(m.id);else await deleteForMe(m.id);setMenu(null);if(selectedId)await load(selectedId)}catch(e){setError(err(e))}};
 const runSearch=async()=>{if(!query.trim()){setResults([]);return}try{setResults(await searchChat(query,selectedId??undefined))}catch(e){setError(err(e))}};
 const selected=conversations.find(c=>c.conversation_id===selectedId)??null;
 const unread=useMemo(()=>conversations.reduce((n,c)=>n+Number(c.unread_count??0),0),[conversations]);

 return <div dir="rtl" className="h-[calc(100vh-130px)] min-h-[560px] flex flex-col md:flex-row gap-3">
  <section className="w-full md:w-[330px] rounded-2xl border app-border bg-[var(--surface)] overflow-hidden flex flex-col">
   <header className="p-3 border-b app-border flex items-center gap-2"><MessageCircle size={20}/><div className="flex-1"><b>گفتگوها</b><div className="text-[11px] app-muted">{unread?String(unread)+' پیام خوانده‌نشده':'همه پیام‌ها خوانده شده‌اند'}</div></div><button className="icon-btn" onClick={()=>void openPeople()} aria-label="گفتگوی جدید"><Plus size={19}/></button></header>
   <div className="p-2 border-b app-border flex gap-2"><Search size={17} className="app-muted mt-3"/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void runSearch()}} placeholder="جست‌وجوی پیام، فایل یا فرد" className="bg-transparent outline-none flex-1 text-sm min-w-0 min-h-11"/></div>
   <div className="flex-1 overflow-y-auto">{loading?<div className="p-4 app-muted text-sm">در حال بارگذاری…</div>:conversations.map(c=><button key={c.conversation_id} onClick={()=>setSelectedId(c.conversation_id)} className={'w-full text-right p-3 border-b app-border min-h-[76px] '+(selectedId===c.conversation_id?'bg-[color-mix(in_srgb,var(--primary)_9%,transparent)]':'')}><div className="flex gap-2 items-start"><div className="h-10 w-10 shrink-0 rounded-full bg-[var(--primary)] text-white flex items-center justify-center"><MessageCircle size={18}/></div><div className="min-w-0 flex-1"><b className="block truncate">{title(c)}</b><div className="text-xs app-muted truncate mt-1">{c.last_message_body??'هنوز پیامی ثبت نشده است'}</div></div>{Number(c.unread_count)>0&&<span className="rounded-full min-w-6 h-6 px-1 flex items-center justify-center text-xs bg-[var(--primary)] text-white">{c.unread_count}</span>}</div></button>)}{!loading&&!conversations.length&&<div className="p-8 text-center app-muted"><MessageCircle className="mx-auto mb-2"/>هنوز گفتگویی ندارید.</div>}</div>
  </section>
  <section className="flex-1 min-w-0 rounded-2xl border app-border bg-[var(--surface)] overflow-hidden flex flex-col">
   {selected?<><header className="min-h-16 border-b app-border px-4 flex items-center gap-3"><div className="h-10 w-10 rounded-full bg-[var(--primary)] text-white flex items-center justify-center"><Users size={18}/></div><div className="flex-1 min-w-0"><b className="truncate block">{title(selected)}</b><span className="text-[11px] app-muted">{realtimeState==='subscribed'?'Realtime فعال':realtimeState==='degraded'?'Realtime در حالت جایگزین · همگام‌سازی دوره‌ای':'در حال اتصال…'}{typingUsers.length?' · در حال نوشتن…':''}</span></div>{online&&realtimeState==='subscribed'?<Wifi size={17}/>:<WifiOff size={17}/>}</header>
   {results.length>0&&<div className="border-b app-border p-2 max-h-36 overflow-y-auto">{results.map(r=><button key={r.id} className="block w-full text-right p-2 rounded-lg hover:bg-black/5" onClick={()=>setResults([])}><b className="text-sm">{r.title}</b><div className="text-xs app-muted truncate">{r.snippet}</div></button>)}</div>}
   <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-2">{messages.map(m=>{const own=m.sender_id===user?.id;const deleted=Boolean(m.deleted_for_all_at);return <div key={m.id} className={'flex '+(own?'justify-start':'justify-end')}><div className="group max-w-[88%] md:max-w-[70%]"><div className={'relative rounded-2xl px-3 py-2 '+(own?'bg-[var(--primary)] text-white rounded-br-md':'bg-black/5 dark:bg-white/10 rounded-bl-md')}><div className="text-sm whitespace-pre-wrap break-words">{deleted?'این پیام حذف شده است.':m.body}</div><div className="flex items-center gap-1 mt-1 text-[9px] opacity-70">{m.edited_at&&<span>ویرایش‌شده</span>}<span>{formatJalaliDateTime(new Date(m.created_at))}</span>{own&&<CheckCheck size={13}/>} {!deleted&&<button onClick={()=>setMenu(menu===m.id?null:m.id)} aria-label="گزینه‌های پیام"><MoreVertical size={14}/></button>}</div>{menu===m.id&&<div className="absolute z-10 left-1 bottom-7 rounded-xl border app-border bg-[var(--surface)] shadow-xl p-1 min-w-36"><button className="w-full text-right px-3 py-2 text-xs" onClick={()=>{setReply(m);setMenu(null)}}>پاسخ</button><button className="w-full text-right px-3 py-2 text-xs" onClick={()=>void remove(m,false)}><Trash2 size={13} className="inline ml-1"/>حذف برای من</button>{own&&<button className="w-full text-right px-3 py-2 text-xs" onClick={()=>void remove(m,true)}>حذف برای همه</button>}</div>}</div></div></div>})}<div ref={bottom}/></div>
   {reply&&<div className="mx-3 mb-2 rounded-xl border app-border p-2 flex gap-2"><div className="flex-1 text-xs truncate">پاسخ به: {reply.body??'پیام'}</div><button onClick={()=>setReply(null)}>لغو</button></div>}
   <div className="border-t app-border p-2 md:p-3 flex items-end gap-2"><textarea value={text} onChange={e=>{setText(e.target.value);broadcastTyping(Boolean(e.target.value.trim()))}} onBlur={()=>broadcastTyping(false)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}} placeholder={online?'پیام بنویسید…':'آفلاین؛ پس از اتصال ارسال می‌شود…'} rows={1} className="flex-1 resize-none min-h-11 max-h-32 rounded-xl border app-border bg-transparent px-3 py-2 outline-none"/><button className="min-h-11 min-w-11 rounded-xl bg-[var(--primary)] text-white flex items-center justify-center disabled:opacity-40" disabled={!text.trim()||sending} onClick={()=>void send()} aria-label="ارسال"><Send size={19}/></button></div>
   </>:<div className="flex-1 flex items-center justify-center app-muted"><MessageCircle size={32} className="ml-2"/>یک گفتگو را انتخاب کنید.</div>}
  </section>
  {peopleOpen&&<div className="fixed inset-0 z-[600] bg-black/40 flex items-end md:items-center justify-center p-3" onClick={()=>setPeopleOpen(false)}><div dir="rtl" className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-2xl bg-[var(--surface)] border app-border shadow-2xl" onClick={e=>e.stopPropagation()}><div className="p-4 border-b app-border"><b>گفتگوی جدید</b></div><div className="overflow-y-auto">{people.filter(p=>p.id!==user?.id).map(p=><button key={p.id} onClick={()=>void newChat(p.id)} className="w-full p-3 flex items-center gap-3 border-b app-border text-right min-h-16"><div className="h-9 w-9 rounded-full bg-[var(--primary)] text-white flex items-center justify-center">{p.full_name.slice(0,1)}</div><div><b>{p.full_name}</b><div className="text-xs app-muted">{p.role} · {p.phone??'بدون شماره'}</div></div></button>)}</div></div></div>}
  {error&&<div className="fixed bottom-4 left-4 right-4 md:right-auto z-[700] max-w-md rounded-xl border app-border bg-[var(--surface)] p-3 shadow-xl text-sm">{error}<button className="block text-xs mt-2 app-muted" onClick={()=>setError(null)}>بستن</button></div>}
 </div>
};
