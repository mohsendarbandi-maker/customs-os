import React,{useCallback,useEffect,useMemo,useRef,useState}from'react';
import{CheckCheck,Hash,MessageCircle,Mic,MicOff,MoreVertical,Paperclip,Plus,ScanText,Search,Send,Trash2,UserPlus,Users,Wifi,WifiOff,X}from'lucide-react';
import{useAuth}from'../../context/AuthContext';
import{normalizeFaText,formatJalaliDateTime}from'../../lib/jalali';
import{makeClientId}from'../../lib/clientId';
import{addConversationMember,createConversation,createDirectConversation,deleteForAll,deleteForMe,listConversations,listMessages,markRead,searchChat,sendFileMessage,sendMessage}from'./api';
import { recognize } from 'tesseract.js';
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
 const[people,setPeople]=useState<Person[]>([]);
 const[peopleOpen,setPeopleOpen]=useState(false);
 const[query,setQuery]=useState('');
 const[results,setResults]=useState<Array<{kind:string;id:string;conversation_id:string;title:string;snippet:string;created_at:string}>>([]);
 const[reply,setReply]=useState<ChatMessage|null>(null),[peopleMode,setPeopleMode]=useState<'direct'|'member'>('direct'),[channelOpen,setChannelOpen]=useState(false),[channelTitle,setChannelTitle]=useState(''),[channelType,setChannelType]=useState<'group'|'company_channel'|'shared_company'>('company_channel'),[sharedConnections,setSharedConnections]=useState<Array<{id:string,target_organization_id:string,target_name:string}>>([]),[selectedConnection,setSelectedConnection]=useState(''),[attachmentBusy,setAttachmentBusy]=useState(false),[recording,setRecording]=useState(false),[ocrBusy,setOcrBusy]=useState(false);
 const[menu,setMenu]=useState<string|null>(null);
 const bottom=useRef<HTMLDivElement|null>(null);const fileInput=useRef<HTMLInputElement|null>(null);const recorderRef=useRef<MediaRecorder|null>(null);const streamRef=useRef<MediaStream|null>(null);const voiceChunks=useRef<Blob[]>([]);
 const messageIdsRef=useRef<Set<string>>(new Set());
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
  if(profile?.organization_id){void (async()=>{try{const {data,error:e}=await supabase.from('org_connections').select('id,target_organization_id').eq('source_organization_id',profile.organization_id).eq('status','accepted').is('deleted_at',null);if(e)throw e;const ids=(data??[]).map(x=>x.target_organization_id);if(!ids.length){setSharedConnections([]);return}const {data:orgs,error:oe}=await supabase.from('organizations').select('id,name').in('id',ids);if(oe)throw oe;const names=new Map((orgs??[]).map(x=>[x.id,x.name]));setSharedConnections((data??[]).map(x=>({id:x.id,target_organization_id:x.target_organization_id,target_name:names.get(x.target_organization_id)||'سازمان مقصد'})))}catch{setSharedConnections([])}})()}
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
  setRealtimeState('connecting');
  setTypingUsers([]);

  const ch=supabase.channel('chat:'+selectedId,{config:{private:true,presence:{key:user?.id??'anonymous'}}})
   .on('postgres_changes',{event:'*',schema:'public',table:'chat_messages',filter:'conversation_id=eq.'+selectedId},()=>{void load(selectedId);void refresh()})
   .on('postgres_changes',{event:'*',schema:'public',table:'chat_message_receipts'},payload=>{const id=(payload.new as any)?.message_id||(payload.old as any)?.message_id;if(id&&messageIdsRef.current.has(id))void load(selectedId)})
   .on('postgres_changes',{event:'*',schema:'public',table:'chat_message_reactions'},payload=>{const id=(payload.new as any)?.message_id||(payload.old as any)?.message_id;if(id&&messages.some(m=>m.id===id))void load(selectedId)})
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
       setRealtimeState('subscribed');pollDelay.current=30000;
       if(user?.id)await ch.track({user_id:user.id,typing:false,at:Date.now()});
     }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
       setRealtimeState('degraded');pollDelay.current=Math.min(30000,Math.max(5000,pollDelay.current));
     }
   });
  channel.current=ch;
  schedulePoll(selectedId,5000);
  return()=>{if(pollTimer.current!==null)window.clearTimeout(pollTimer.current);void supabase.removeChannel(ch);channel.current=null}
 },[selectedId,user?.id,load,refresh,schedulePoll]);

 useEffect(()=>{messageIdsRef.current=new Set(messages.map(m=>m.id));bottom.current?.scrollIntoView({behavior:'smooth'})},[messages,selectedId]);

 const broadcastTyping=useCallback((typing:boolean)=>{
  if(!channel.current||!user?.id)return;
  const now=Date.now();
  if(typing&&now-lastTypingSent.current<500)return;
  lastTypingSent.current=now;
  void channel.current.send({type:'broadcast',event:'typing',payload:{user_id:user.id,typing}});
  if(typing&&typingTimer.current!==null)window.clearTimeout(typingTimer.current);
  if(typing)typingTimer.current=window.setTimeout(()=>broadcastTyping(false),1200);
 },[user?.id]);

 const openPeople=async(mode:'direct'|'member'='direct')=>{
  if(!profile?.organization_id)return;
  const{data,error:e}=await supabase.from('profiles').select('id,full_name,phone,role').eq('organization_id',profile.organization_id).eq('is_active',true).order('full_name');
  if(e){setError(err(e));return}setPeople((data??[])as Person[]);setPeopleMode(mode);setPeopleOpen(true);
 };
 const newChat=async(id:string)=>{try{const c=await createDirectConversation(id);await refresh();setSelectedId(c.conversation_id);setPeopleOpen(false)}catch(e){setError(err(e))}};
 const addMember=async(id:string)=>{if(!selectedId)return;try{await addConversationMember(selectedId,id);setPeopleOpen(false);await refresh()}catch(e){setError(err(e))}};
 const createChannel=async()=>{const name=channelTitle.trim();if(!name)return;if(channelType==='shared_company'&&!selectedConnection){setError('برای کانال مشترک، سازمان متصل را انتخاب کنید.');return}try{const conn=sharedConnections.find(x=>x.id===selectedConnection);const c=await createConversation({type:channelType,title:name,sharedWithOrganizationId:conn?.target_organization_id??null,orgConnectionId:conn?.id??null});setChannelTitle('');setChannelOpen(false);await refresh();setSelectedId(c.id)}catch(e){setError(err(e))}};
 const chooseAttachment=async(file?:File)=>{if(!file||!selectedId||!profile?.organization_id||attachmentBusy)return;if(file.size>50*1024*1024){setError('حجم فایل بیش از ۵۰MB است.');return}setAttachmentBusy(true);try{await sendFileMessage(selectedId,profile.organization_id,file,'file');if(file.type.startsWith('image/')){setOcrBusy(true);try{const ocr=await recognize(file,'fas+eng');const ocrText=String(ocr.data?.text||'').trim();if(ocrText)setText(ocrText)}catch{}finally{setOcrBusy(false)}}await load(selectedId);await refresh()}catch(e){setError(err(e))}finally{setAttachmentBusy(false)}};
 const toggleVoice=async()=>{if(!selectedId||!profile?.organization_id||attachmentBusy)return;if(recording){try{recorderRef.current?.stop()}catch{}return}if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError('ضبط صدا در این دستگاه در دسترس نیست.');return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});streamRef.current=stream;voiceChunks.current=[];const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x));const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);recorderRef.current=recorder;recorder.ondataavailable=e=>{if(e.data?.size)voiceChunks.current.push(e.data)};recorder.onstop=async()=>{try{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(voiceChunks.current,{type:mime||'audio/mp4'});voiceChunks.current=[];recorderRef.current=null;streamRef.current=null;setRecording(false);if(blob.size<1000){setError('صدای قابل استفاده‌ای ضبط نشد.');return}setAttachmentBusy(true);const ext=(blob.type||'audio/mp4').includes('webm')?'webm':'mp4';await sendFileMessage(selectedId,profile.organization_id,new File([blob],`voice-${Date.now()}.${ext}`,{type:blob.type||'audio/mp4'}),'voice');await load(selectedId);await refresh()}catch(e){setError(err(e))}finally{setAttachmentBusy(false)}};recorder.start(250);setRecording(true)}catch(e){setError(err(e))}};

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
   <header className="p-3 border-b app-border flex items-center gap-2"><MessageCircle size={20}/><div className="flex-1"><b>گفتگوها</b><div className="text-[11px] app-muted">{unread?String(unread)+' پیام خوانده‌نشده':'همه پیام‌ها خوانده شده‌اند'}</div></div><button className="icon-btn" onClick={()=>void openPeople("direct")} aria-label="گفتگوی مستقیم"><Plus size={19}/></button><button className="icon-btn" onClick={()=>{setChannelType("company_channel");setChannelOpen(true)}} aria-label="کانال جدید"><Hash size={18}/></button></header>
   <div className="p-2 border-b app-border flex gap-2"><Search size={17} className="app-muted mt-3"/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void runSearch()}} placeholder="جست‌وجوی پیام، فایل یا فرد" className="bg-transparent outline-none flex-1 text-sm min-w-0 min-h-11"/></div>
   <div className="flex-1 overflow-y-auto">{loading?<div className="p-4 app-muted text-sm">در حال بارگذاری…</div>:conversations.map(c=><button key={c.conversation_id} onClick={()=>setSelectedId(c.conversation_id)} className={'w-full text-right p-3 border-b app-border min-h-[76px] '+(selectedId===c.conversation_id?'bg-[color-mix(in_srgb,var(--primary)_9%,transparent)]':'')}><div className="flex gap-2 items-start"><div className="h-10 w-10 shrink-0 rounded-full bg-[var(--primary)] text-white flex items-center justify-center"><MessageCircle size={18}/></div><div className="min-w-0 flex-1"><b className="block truncate">{title(c)}</b><div className="text-xs app-muted truncate mt-1">{c.last_message_body??'هنوز پیامی ثبت نشده است'}</div></div>{Number(c.unread_count)>0&&<span className="rounded-full min-w-6 h-6 px-1 flex items-center justify-center text-xs bg-[var(--primary)] text-white">{c.unread_count}</span>}</div></button>)}{!loading&&!conversations.length&&<div className="p-8 text-center app-muted"><MessageCircle className="mx-auto mb-2"/>هنوز گفتگویی ندارید.</div>}</div>
  </section>
  <section className="flex-1 min-w-0 rounded-2xl border app-border bg-[var(--surface)] overflow-hidden flex flex-col">
   {selected?<><header className="min-h-16 border-b app-border px-4 flex items-center gap-3"><div className="h-10 w-10 rounded-full bg-[var(--primary)] text-white flex items-center justify-center"><Users size={18}/></div><div className="flex-1 min-w-0"><b className="truncate block">{title(selected)}</b><span className="text-[11px] app-muted">{realtimeState==='subscribed'?'Realtime فعال':realtimeState==='degraded'?'Realtime در حالت جایگزین · همگام‌سازی دوره‌ای':'در حال اتصال…'}{typingUsers.length?' · در حال نوشتن…':''}</span></div><div className="flex items-center gap-1">{selected&&(selected.type==="group"||selected.type==="company_channel")&&<button className="icon-btn" title="افزودن عضو" onClick={()=>void openPeople("member")}><UserPlus size={16}/></button>}{online&&realtimeState==="subscribed"?<Wifi size={17}/>:<WifiOff size={17}/>}</div></header>
   {results.length>0&&<div className="border-b app-border p-2 max-h-36 overflow-y-auto">{results.map(r=><button key={r.id} className="block w-full text-right p-2 rounded-lg hover:bg-black/5" onClick={()=>setResults([])}><b className="text-sm">{r.title}</b><div className="text-xs app-muted truncate">{r.snippet}</div></button>)}</div>}
   <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-2">{messages.map(m=>{const own=m.sender_id===user?.id;const deleted=Boolean(m.deleted_for_all_at);return <div key={m.id} className={'flex '+(own?'justify-start':'justify-end')}><div className="group max-w-[88%] md:max-w-[70%]"><div className={'relative rounded-2xl px-3 py-2 '+(own?'bg-[var(--primary)] text-white rounded-br-md':'bg-black/5 dark:bg-white/10 rounded-bl-md')}><div className="text-sm whitespace-pre-wrap break-words">{deleted?'این پیام حذف شده است.':m.body}</div>{!deleted&&(m.attachments??[]).map(a=>a.security_status==="clean"&&a.url?(a.mime_type.startsWith("audio/")?<audio key={a.id} controls src={a.url} className="mt-2 max-w-full"/>:<a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 rounded-xl bg-black/10 dark:bg-white/10 px-3 py-2 text-xs underline"><Paperclip size={14}/>{a.original_name}</a>):<div key={a.id} className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs">{a.security_status==="blocked"?"فایل مسدود شد.":"فایل در حال بررسی امنیتی است…"}</div>)}<div className="flex items-center gap-1 mt-1 text-[9px] opacity-70">{m.edited_at&&<span>ویرایش‌شده</span>}<span>{formatJalaliDateTime(new Date(m.created_at))}</span>{own&&<CheckCheck size={13}/>} {!deleted&&<button onClick={()=>setMenu(menu===m.id?null:m.id)} aria-label="گزینه‌های پیام"><MoreVertical size={14}/></button>}</div>{menu===m.id&&<div className="absolute z-10 left-1 bottom-7 rounded-xl border app-border bg-[var(--surface)] shadow-xl p-1 min-w-36"><button className="w-full text-right px-3 py-2 text-xs" onClick={()=>{setReply(m);setMenu(null)}}>پاسخ</button><button className="w-full text-right px-3 py-2 text-xs" onClick={()=>void remove(m,false)}><Trash2 size={13} className="inline ml-1"/>حذف برای من</button>{own&&<button className="w-full text-right px-3 py-2 text-xs" onClick={()=>void remove(m,true)}>حذف برای همه</button>}</div>}</div></div></div>})}<div ref={bottom}/></div>
   {reply&&<div className="mx-3 mb-2 rounded-xl border app-border p-2 flex gap-2"><div className="flex-1 text-xs truncate">پاسخ به: {reply.body??'پیام'}</div><button onClick={()=>setReply(null)}>لغو</button></div>}
   <div className="border-t app-border p-2 md:p-3"><input ref={fileInput} type="file" className="hidden" accept="image/*,application/pdf,text/plain,.doc,.docx,.xls,.xlsx" onChange={e=>{const f=e.target.files?.[0];e.currentTarget.value="";void chooseAttachment(f)}}/><div className="flex items-end gap-2"><button type="button" className="min-h-11 min-w-11 rounded-xl border app-border flex items-center justify-center disabled:opacity-40" disabled={attachmentBusy} onClick={()=>fileInput.current?.click()} aria-label="پیوست فایل"><Paperclip size={18}/></button><button type="button" className={"min-h-11 min-w-11 rounded-xl border app-border flex items-center justify-center "+(recording?"bg-red-600 text-white":"")} disabled={attachmentBusy} onClick={()=>void toggleVoice()} aria-label={recording?"توقف ضبط":"ضبط صدا"}>{recording?<MicOff size={18}/>:<Mic size={18}/>}</button><textarea value={text} onChange={e=>{setText(e.target.value);broadcastTyping(Boolean(e.target.value.trim()))}} onBlur={()=>broadcastTyping(false)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send()}}} placeholder={online?"پیام بنویسید…":"آفلاین؛ پس از اتصال ارسال می‌شود…"} rows={1} className="flex-1 resize-none min-h-11 max-h-32 rounded-xl border app-border bg-transparent px-3 py-2 outline-none"/><button className="min-h-11 min-w-11 rounded-xl bg-[var(--primary)] text-white flex items-center justify-center disabled:opacity-40" disabled={!text.trim()||sending||attachmentBusy} onClick={()=>void send()} aria-label="ارسال"><Send size={19}/></button></div>{attachmentBusy&&<div className="text-[10px] app-muted mt-2">در حال ارسال و بررسی فایل…</div>}{ocrBusy&&<div className="text-[10px] app-muted mt-1 flex items-center gap-1"><ScanText size={13}/> در حال OCR تصویر…</div>}</div>
   </>:<div className="flex-1 flex items-center justify-center app-muted"><MessageCircle size={32} className="ml-2"/>یک گفتگو را انتخاب کنید.</div>}
  </section>
  {peopleOpen&&<div className="fixed inset-0 z-[600] bg-black/40 flex items-end md:items-center justify-center p-3" onClick={()=>setPeopleOpen(false)}><div dir="rtl" className="w-full max-w-lg max-h-[80vh] overflow-hidden rounded-2xl bg-[var(--surface)] border app-border shadow-2xl" onClick={e=>e.stopPropagation()}><div className="p-4 border-b app-border flex items-center justify-between"><b>{peopleMode==="direct"?"گفتگوی جدید":"افزودن عضو"}</b><button onClick={()=>setPeopleOpen(false)}><X size={17}/></button></div><div className="overflow-y-auto">{people.filter(p=>p.id!==user?.id).map(p=><button key={p.id} onClick={()=>void (peopleMode==="direct"?newChat(p.id):addMember(p.id))} className="w-full p-3 flex items-center gap-3 border-b app-border text-right min-h-16"><div className="h-9 w-9 rounded-full bg-[var(--primary)] text-white flex items-center justify-center">{p.full_name.slice(0,1)}</div><div><b>{p.full_name}</b><div className="text-xs app-muted">{p.role} · {p.phone??'بدون شماره'}</div></div></button>)}</div></div></div>}
  {channelOpen&&<div className="fixed inset-0 z-[610] bg-black/40 flex items-end md:items-center justify-center p-3" onClick={()=>setChannelOpen(false)}><div dir="rtl" className="w-full max-w-md rounded-2xl bg-[var(--surface)] border app-border shadow-2xl p-4" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between"><b>ایجاد کانال / گروه</b><button onClick={()=>setChannelOpen(false)}><X size={17}/></button></div><input value={channelTitle} onChange={e=>setChannelTitle(e.target.value)} placeholder="نام کانال" className="w-full min-h-11 rounded-xl border app-border bg-transparent px-3 mt-4"/><div className="grid grid-cols-2 gap-2 mt-3"><button onClick={()=>setChannelType("company_channel")} className={"min-h-11 rounded-xl border app-border text-xs "+(channelType==="company_channel"?"bg-[var(--primary)] text-white":"")}>کانال داخلی</button><button onClick={()=>setChannelType("group")} className={"min-h-11 rounded-xl border app-border text-xs "+(channelType==="group"?"bg-[var(--primary)] text-white":"")}>گروه</button><button onClick={()=>setChannelType("shared_company")} disabled={!sharedConnections.length} className={"min-h-11 rounded-xl border app-border text-xs "+(channelType==="shared_company"?"bg-[var(--primary)] text-white":"")}>شرکت مشترک</button></div>{channelType==="shared_company"&&<select value={selectedConnection} onChange={e=>setSelectedConnection(e.target.value)} className="w-full min-h-11 rounded-xl border app-border bg-transparent px-3 mt-3"><option value="">انتخاب سازمان متصل</option>{sharedConnections.map(x=><option key={x.id} value={x.id}>{x.target_name}</option>)}</select>}<button disabled={!channelTitle.trim()} onClick={()=>void createChannel()} className="w-full min-h-11 rounded-xl bg-[var(--primary)] text-white font-bold mt-4 disabled:opacity-40">ایجاد</button></div></div>}
  {error&&<div className="fixed bottom-4 left-4 right-4 md:right-auto z-[700] max-w-md rounded-xl border app-border bg-[var(--surface)] p-3 shadow-xl text-sm">{error}<button className="block text-xs mt-2 app-muted" onClick={()=>setError(null)}>بستن</button></div>}
 </div>
};
