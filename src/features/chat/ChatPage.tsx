import{useSearchParams}from'react-router-dom';
import React,{useCallback,useEffect,useMemo,useRef,useState}from'react';
import{ArrowRight,Bell,BellOff,Check,CheckCheck,Hash,MessageCircle,Mic,MicOff,MoreVertical,Paperclip,Phone,Plus,ScanText,Search,Send,Trash2,UserPlus,UserRound,Users,Wifi,WifiOff,X}from'lucide-react';
import{useAuth}from'../../context/AuthContext';
import{normalizeFaText}from'../../lib/jalali';
import{makeClientId}from'../../lib/clientId';
import{enableChatPush,hasChatPushSubscription}from'./push';
import{addConversationMember,createConversation,createDirectConversation,deleteForAll,deleteForMe,listConversations,listMessages,listOrgConnections,markRead,searchChat,sendFileMessage,sendMessage}from'./api';
import { recognize } from 'tesseract.js';
import{supabase}from'../../lib/supabase';
import type{ChatConversation,ChatMessage}from'./types';
import {ChatBrandLogo} from './ChatBrandLogo';
import {useVoiceCall} from './voiceCall';
import {VoiceCallPanel} from './VoiceCallPanel';

type Person={id:string;full_name:string;phone:string|null;role:string};
type PresenceUser={user_id:string;typing?:boolean};
const err=(e:unknown)=>e instanceof Error?e.message:'عملیات چت انجام نشد. دوباره تلاش کنید.';
const title=(c:ChatConversation)=>c.display_name||c.title||(c.type==='direct'?'گفتگوی مستقیم':c.type==='shared_company'?'گفتگوی مشترک شرکت‌ها':c.type==='company_channel'?'کانال سازمان':'گفتگو');
const chatTime=(value:string|null)=>value?new Intl.DateTimeFormat('fa-IR-u-ca-persian',{timeZone:'Asia/Tehran',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'';
const dayKey=(value:string)=>new Intl.DateTimeFormat('fa-IR-u-ca-persian',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const dayLabel=(value:string)=>{
 const target=dayKey(value);
 const today=dayKey(new Date().toISOString());
 const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
 if(target===today)return 'امروز';
 if(target===dayKey(yesterday.toISOString()))return 'دیروز';
 return new Intl.DateTimeFormat('fa-IR-u-ca-persian',{timeZone:'Asia/Tehran',weekday:'long',day:'numeric',month:'long'}).format(new Date(value));
};

export const ChatPage:React.FC=()=>{
 const{user,profile}=useAuth();
 const[searchParams]=useSearchParams();
 const requestedConversationId=searchParams.get('conversation');
 const requestedCallId=searchParams.get('call');
 useEffect(()=>{
  const previousTitle=document.title;
  const icon=document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const previousIcon=icon?.getAttribute('href')??null;
  const previousOverflow=document.body.style.overflow;
  document.title='چت سازمانی | Customs OS';
  if(icon)icon.href='/chat-icon.svg';
  document.body.style.overflow='hidden';
  document.documentElement.style.overflow='hidden';
  return()=>{
    document.title=previousTitle;
    if(icon&&previousIcon)icon.href=previousIcon;
    document.body.style.overflow=previousOverflow;
    document.documentElement.style.overflow='';
  };
 },[]);
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
 const[personQuery,setPersonQuery]=useState('');
 const[query,setQuery]=useState('');
 const[results,setResults]=useState<Array<{kind:string;id:string;conversation_id:string;title:string;snippet:string;created_at:string}>>([]);
 const[reply,setReply]=useState<ChatMessage|null>(null),[peopleMode,setPeopleMode]=useState<'direct'|'member'>('direct'),[channelOpen,setChannelOpen]=useState(false),[channelTitle,setChannelTitle]=useState(''),[channelType,setChannelType]=useState<'group'|'company_channel'|'shared_company'>('company_channel'),[sharedConnections,setSharedConnections]=useState<Array<{id:string,target_organization_id:string,target_name:string}>>([]),[selectedConnection,setSelectedConnection]=useState(''),[attachmentBusy,setAttachmentBusy]=useState(false),[recording,setRecording]=useState(false),[ocrBusy,setOcrBusy]=useState(false),[pushReady,setPushReady]=useState(false),[pushBusy,setPushBusy]=useState(false);
 const[menu,setMenu]=useState<string|null>(null);
 const bottom=useRef<HTMLDivElement|null>(null);const fileInput=useRef<HTMLInputElement|null>(null);const recorderRef=useRef<MediaRecorder|null>(null);const streamRef=useRef<MediaStream|null>(null);const voiceChunks=useRef<Blob[]>([]);
 const messageIdsRef=useRef<Set<string>>(new Set());
 const channel=useRef<ReturnType<typeof supabase.channel>|null>(null);
 const pollTimer=useRef<number|null>(null);
 const pollDelay=useRef(15000);
 const typingTimer=useRef<number|null>(null);
 const lastTypingSent=useRef(0);

 const refresh=useCallback(async()=>{
  try{const data=await listConversations();setConversations(data);if(!selectedId&&data[0]&&window.matchMedia('(min-width:768px)').matches)setSelectedId(data[0].conversation_id)}
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
  if(profile?.organization_id){void listOrgConnections().then(setSharedConnections).catch(()=>setSharedConnections([]))}
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
 useEffect(()=>{
  if(requestedConversationId&&conversations.some(c=>c.conversation_id===requestedConversationId))setSelectedId(requestedConversationId);
 },[requestedConversationId,conversations]);

 useEffect(()=>{let alive=true;void hasChatPushSubscription().then(value=>{if(alive)setPushReady(value)}).catch(()=>{});return()=>{alive=false}},[]);

 const enablePush=async()=>{
  if(pushBusy)return;
  setPushBusy(true);
  try{await enableChatPush(true);setPushReady(true);setError('اعلان‌های چت برای این دستگاه فعال شد.');}
  catch(e){setError(err(e))}
  finally{setPushBusy(false)}
 };


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
  if(e){setError(err(e));return}setPeople((data??[])as Person[]);setPersonQuery('');setPeopleMode(mode);setPeopleOpen(true);
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
 const voice=useVoiceCall({userId:user?.id,organizationId:profile?.organization_id,conversationId:selected?.conversation_id??null,peerUserId:selected?.type==='direct'?selected.display_user_id??null:null,peerName:selected?.display_name||selected?.title||'همکار',requestedCallId});
 useEffect(()=>{if(voice.error)setError(voice.error)},[voice.error]);
 const unread=useMemo(()=>conversations.reduce((n,c)=>n+Number(c.unread_count??0),0),[conversations]);
 const messageMap=useMemo(()=>new Map(messages.map(m=>[m.id,m])),[messages]);
 const filteredPeople=useMemo(()=>{
  const q=normalizeFaText(personQuery).toLowerCase();
  return people.filter(person=>person.id!==user?.id&&!q||person.id!==user?.id&&(normalizeFaText(person.full_name).toLowerCase().includes(q)||(person.phone??'').includes(q)));
 },[people,personQuery,user?.id]);

 return <div dir="rtl" className="chat-standalone w-full h-dvh min-h-[560px] flex gap-0 md:gap-3 bg-[var(--surface)]">
  <section className={(selectedId?"hidden md:flex":"flex")+" w-full md:w-[360px] shrink-0 rounded-2xl md:border app-border bg-[var(--surface)] overflow-hidden flex-col"}>
   <header className="h-[76px] shrink-0 px-4 border-b app-border flex items-center gap-3">
    <ChatBrandLogo size={48}/>
    <div className="flex-1 min-w-0"><b className="block text-[17px]">چت سازمانی</b><div className="text-[12px] app-muted truncate">{unread?String(unread)+' پیام خوانده‌نشده':'ارتباط داخلی Customs OS'}</div></div>
    <button className="h-12 w-12 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" onClick={()=>void openPeople("direct")} aria-label="گفتگوی جدید"><Plus size={19}/></button>
    <button className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" onClick={()=>{setChannelType("company_channel");setChannelOpen(true)}} aria-label="گروه یا کانال جدید"><Hash size={18}/></button>
   </header>
   <div className="px-3 py-2 border-b app-border">
    <div className="h-12 rounded-2xl bg-black/5 dark:bg-white/10 flex items-center gap-2 px-3"><Search size={16} className="app-muted"/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void runSearch()}} placeholder="جست‌وجو" className="bg-transparent outline-none flex-1 text-sm min-w-0"/></div>
   </div>
   <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
    {loading?<div className="p-5 app-muted text-sm">در حال بارگذاری…</div>:
      conversations.map(c=>{
       const name=title(c);const last=c.last_message_body??(c.type==='direct'?'پیام جدید':'هنوز پیامی ثبت نشده است');
       return <button key={c.conversation_id} onClick={()=>{setSelectedId(c.conversation_id);setResults([])}} className={"w-full text-right px-3 py-3 border-b app-border flex items-center gap-3 min-h-[86px] hover:bg-black/5 dark:hover:bg-white/5 "+(selectedId===c.conversation_id?"bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]":"")}>
        <div className="h-14 w-14 shrink-0 rounded-full bg-[var(--primary)] text-white flex items-center justify-center font-bold text-xl">{c.type==='direct'?(name.trim().slice(0,1)||'?'):<>{c.type==='company_channel'?<Hash size={19}/>:<Users size={19}/>}</>}</div>
        <div className="min-w-0 flex-1">
         <div className="flex items-center gap-2"><b className="truncate flex-1 text-[15px]">{name}</b>{c.last_message_created_at&&<span className="text-[10px] app-muted shrink-0">{chatTime(c.last_message_created_at)}</span>}</div>
         <div className="text-[14px] app-muted truncate mt-1">{last}</div>
        </div>
        {Number(c.unread_count)>0&&<span className="rounded-full min-w-6 h-6 px-1 flex items-center justify-center text-[11px] bg-[var(--primary)] text-white">{c.unread_count}</span>}
       </button>
      })}
    {!loading&&!conversations.length&&<div className="p-10 text-center app-muted"><MessageCircle size={34} className="mx-auto mb-3"/><div className="font-bold mb-1">هنوز گفتگویی ندارید</div><div className="text-xs">از دکمه + یک گفتگو با همکاران ایجاد کنید.</div></div>}
   </div>
  </section>

  <section className={(selectedId?"flex":"hidden md:flex")+" flex-1 min-w-0 rounded-2xl md:border app-border bg-[var(--surface)] overflow-hidden flex-col"}>
   {selected?<>
    <header className="h-[72px] shrink-0 border-b app-border px-3 md:px-4 flex items-center gap-2">
     <button className="h-12 w-12 shrink-0 rounded-full flex items-center justify-center md:hidden" onClick={()=>{setSelectedId(null);setMessages([]);setReply(null)}} aria-label="بازگشت"><ArrowRight size={19}/></button>
     <div className="h-12 w-12 rounded-full bg-[var(--primary)] text-white flex items-center justify-center font-bold">{selected.type==='direct'?(title(selected).slice(0,1)||'?'):<>{selected.type==='company_channel'?<Hash size={19}/>:<Users size={19}/>}</>}</div>
     <div className="flex-1 min-w-0">
      <b className="block truncate text-[16px]">{title(selected)}</b>
      <div className="text-[12px] app-muted truncate">{selected.type==='direct'?(typingUsers.length?'در حال نوشتن…':selected.display_phone||'گفتگوی مستقیم'):(typingUsers.length?'در حال نوشتن…':realtimeState==='subscribed'?'متصل':'در حال همگام‌سازی')}</div>
     </div>
     {selected&&(selected.type==="group"||selected.type==="company_channel")&&<button className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" title="افزودن عضو" onClick={()=>void openPeople("member")}><UserPlus size={16}/></button>}
     {selected.type==="direct"&&selected.display_user_id&&voice.canCall&&<button className="h-12 w-12 shrink-0 rounded-full flex items-center justify-center text-white bg-[var(--primary)] hover:opacity-90 shadow-sm" title="تماس صوتی زنده" aria-label="تماس صوتی زنده" onClick={()=>void voice.startCall()}><Phone size={19}/></button>}
     <button className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" title={pushReady?"اعلان‌های پیام فعال است":"فعال‌سازی اعلان پیام"} onClick={()=>void enablePush()} disabled={pushBusy}>{pushReady?<Bell size={17}/>:<BellOff size={17}/>}</button>
     {online&&realtimeState==="subscribed"?<Wifi size={16}/>:<WifiOff size={16}/>}
    </header>

    {results.length>0&&<div className="border-b app-border px-3 py-2 max-h-40 overflow-y-auto">{results.map(r=><button key={r.id} className="block w-full text-right p-2 rounded-lg hover:bg-black/5" onClick={()=>setResults([])}><b className="text-sm">{r.title}</b><div className="text-xs app-muted truncate">{r.snippet}</div></button>)}</div>}

    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-5 md:px-5 md:py-6 overscroll-contain bg-[radial-gradient(circle_at_20%_20%,rgba(0,0,0,.03),transparent_20%),radial-gradient(circle_at_80%_80%,rgba(0,0,0,.025),transparent_18%)] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,.03),transparent_20%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,.02),transparent_18%)]">
     {messages.map((m,index)=>{
      const own=m.sender_id===user?.id;const deleted=Boolean(m.deleted_for_all_at);const previous=messages[index-1];const showDay=!previous||dayKey(previous.created_at)!==dayKey(m.created_at);const quoted=m.reply_to_message_id?messageMap.get(m.reply_to_message_id):null;
      return <React.Fragment key={m.id}>
       {showDay&&<div className="flex justify-center my-3"><span className="px-3 py-1 rounded-full bg-black/5 dark:bg-white/10 text-[10px] app-muted shadow-sm">{dayLabel(m.created_at)}</span></div>}
       <div className={"flex mb-1.5 "+(own?"justify-start":"justify-end")}>
        <div className="max-w-[88%] md:max-w-[72%]">
         <div className={"relative rounded-2xl px-4 py-2.5 shadow-sm "+(own?"bg-[var(--primary)] text-white rounded-br-md":"bg-black/5 dark:bg-white/10 rounded-bl-md")}>
          {!own&&selected.type!=="direct"&&m.sender_name&&<div className={"text-[10px] font-bold mb-1 "+(own?"opacity-80":"app-muted")}>{m.sender_name}</div>}
          {quoted&&<button className={"w-full text-right mb-2 px-2 py-1 rounded-lg border border-current/20 text-[10px] opacity-80"} onClick={()=>{const el=document.getElementById("msg-"+quoted.id);el?.scrollIntoView({behavior:"smooth",block:"center"})}}>{quoted.body||'پیام پیوست‌دار'}</button>}
          {deleted?<div className="text-sm italic opacity-80">این پیام حذف شده است.</div>:m.body&&<div className="text-[17px] leading-8 whitespace-pre-wrap break-words">{m.body}</div>}
          {!deleted&&(m.attachments??[]).map(a=>a.security_status==="clean"&&a.url?(a.mime_type.startsWith("audio/")?<audio key={a.id} controls src={a.url} className="mt-2 w-full max-w-[280px]"/>:<a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 rounded-xl bg-black/10 dark:bg-white/10 px-3 py-2 text-xs underline"><Paperclip size={14}/><span className="truncate">{a.original_name}</span></a>):<div key={a.id} className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs">{a.security_status==="blocked"?"فایل مسدود شد.":"فایل در حال بررسی امنیتی است…"}</div>)}
          <div className={"flex items-center justify-end gap-1 mt-1 text-[11px] "+(own?"text-white/75":"app-muted")}>
           {m.edited_at&&<span>ویرایش‌شده</span>}<span>{chatTime(m.created_at)}</span>
           {own&&(m.delivery_status==='sent'?<Check size={12}/>:m.delivery_status==='delivered'||m.delivery_status==='read'?<CheckCheck size={13}/>:<span className="opacity-70">در حال ارسال</span>)}
           {!deleted&&<button onClick={()=>setMenu(menu===m.id?null:m.id)} aria-label="گزینه‌های پیام"><MoreVertical size={14}/></button>}
          </div>
          {menu===m.id&&<div className="absolute z-20 left-1 bottom-7 rounded-xl border app-border bg-[var(--surface)] text-[var(--text)] shadow-xl p-1 min-w-36">
           <button className="w-full text-right px-3 py-2 text-xs" onClick={()=>{setReply(m);setMenu(null)}}>پاسخ</button>
           <button className="w-full text-right px-3 py-2 text-xs" onClick={()=>void remove(m,false)}><Trash2 size={13} className="inline ml-1"/>حذف برای من</button>
           {own&&<button className="w-full text-right px-3 py-2 text-xs" onClick={()=>void remove(m,true)}>حذف برای همه</button>}
          </div>}
         </div>
        </div>
       </div>
      </React.Fragment>
     })}
     <div ref={bottom}/>
    </div>

    {reply&&<div className="mx-2 md:mx-3 mb-1 rounded-xl border app-border bg-black/5 dark:bg-white/5 p-2 flex gap-2 items-center"><div className="w-1 self-stretch rounded-full bg-[var(--primary)]"/><div className="flex-1 min-w-0 text-xs truncate">پاسخ به: {reply.body||'پیام پیوست‌دار'}</div><button className="icon-btn" onClick={()=>setReply(null)} aria-label="لغو پاسخ"><X size={15}/></button></div>}

    <div className="shrink-0 border-t app-border p-3 md:p-3 bg-[var(--surface)]">
    {!pushReady&&<button type="button" onClick={()=>void enablePush()} disabled={pushBusy} className="mb-2 w-full min-h-12 rounded-2xl border app-border bg-[var(--primary)]/10 px-4 flex items-center gap-3 text-right disabled:opacity-50">
      <span className="h-10 w-10 shrink-0 rounded-full bg-[var(--primary)] text-white flex items-center justify-center"><Bell size={19}/></span>
      <span className="min-w-0 flex-1"><b className="block text-sm">اعلان پیام‌ها را فعال کنید</b><span className="block text-xs app-muted mt-0.5">برای دریافت پیام جدید مثل واتساپ</span></span>
      <span className="text-xs font-bold text-[var(--primary)]">{pushBusy?'در حال فعال‌سازی…':'فعال‌سازی'}</span>
    </button>}

     <input ref={fileInput} type="file" className="hidden" accept="image/*,application/pdf,text/plain,.doc,.docx,.xls,.xlsx" onChange={e=>{const f=e.target.files?.[0];e.currentTarget.value="";void chooseAttachment(f)}}/>
     <div className="flex items-end gap-1.5 md:gap-2">
      <button type="button" className="h-12 w-12 shrink-0 rounded-full border app-border flex items-center justify-center disabled:opacity-40" disabled={attachmentBusy} onClick={()=>fileInput.current?.click()} aria-label="پیوست"><Paperclip size={18}/></button>
      <button type="button" className={"h-11 w-11 shrink-0 rounded-full border app-border flex items-center justify-center "+(recording?"bg-red-600 text-white":"")} disabled={attachmentBusy} onClick={()=>void toggleVoice()} aria-label={recording?"توقف ضبط":"ضبط صدا"}>{recording?<MicOff size={18}/>:<Mic size={18}/>}</button>
      <textarea value={text} onChange={e=>{setText(e.target.value);broadcastTyping(Boolean(e.target.value.trim()))}} onBlur={()=>broadcastTyping(false)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send()}}} placeholder={online?"پیام بنویسید…":"آفلاین؛ پس از اتصال ارسال می‌شود…"} rows={1} className="flex-1 resize-none min-h-12 max-h-32 rounded-[24px] border app-border bg-transparent px-4 py-3 outline-none text-[15px]"/>
      <button className="h-12 w-12 shrink-0 rounded-full bg-[var(--primary)] text-white flex items-center justify-center disabled:opacity-40" disabled={!text.trim()||sending||attachmentBusy} onClick={()=>void send()} aria-label="ارسال"><Send size={18}/></button>
     </div>
     {(attachmentBusy||ocrBusy)&&<div className="text-[10px] app-muted mt-1 px-1">{attachmentBusy?"در حال ارسال فایل…":"در حال OCR تصویر…"}</div>}
    </div>
   </>:<div className="flex-1 items-center justify-center app-muted">یک گفتگو را انتخاب کنید.</div>}
  </section>

  {peopleOpen&&<div className="fixed inset-0 z-[600] bg-black/45 flex items-end md:items-center justify-center" onClick={()=>setPeopleOpen(false)}>
   <div dir="rtl" className="w-full md:max-w-lg max-h-[86vh] overflow-hidden rounded-t-3xl md:rounded-2xl bg-[var(--surface)] border app-border shadow-2xl" onClick={e=>e.stopPropagation()}>
    <div className="p-4 border-b app-border flex items-center gap-2"><div className="flex-1"><b>{peopleMode==="direct"?"گفتگوی جدید":"افزودن عضو"}</b><div className="text-xs app-muted mt-1">{peopleMode==="direct"?"یک همکار را انتخاب کنید.":"عضو جدید را انتخاب کنید."}</div></div><button className="icon-btn" onClick={()=>setPeopleOpen(false)}><X size={17}/></button></div>
    <div className="p-3 border-b app-border"><div className="h-11 rounded-xl bg-black/5 dark:bg-white/10 flex items-center gap-2 px-3"><Search size={16}/><input autoFocus value={personQuery} onChange={e=>setPersonQuery(e.target.value)} placeholder="جست‌وجوی مخاطب" className="bg-transparent outline-none flex-1 text-sm"/></div></div>
    <div className="max-h-[58vh] overflow-y-auto">
     {filteredPeople.map(p=><button key={p.id} onClick={()=>void (peopleMode==="direct"?newChat(p.id):addMember(p.id))} className="w-full p-3 flex items-center gap-3 border-b app-border text-right min-h-[70px] hover:bg-black/5 dark:hover:bg-white/5">
      <div className="h-11 w-11 shrink-0 rounded-full bg-[var(--primary)] text-white flex items-center justify-center font-bold">{p.full_name.trim().slice(0,1)||<UserRound size={17}/>}</div>
      <div className="min-w-0 flex-1"><b className="block truncate">{p.full_name}</b><div className="text-xs app-muted truncate mt-1">{p.phone||'شماره ثبت نشده'} · {p.role}</div></div>
     </button>)}
     {!filteredPeople.length&&<div className="p-8 text-center app-muted text-sm">مخاطبی پیدا نشد.</div>}
    </div>
   </div>
  </div>}

  {channelOpen&&<div className="fixed inset-0 z-[610] bg-black/45 flex items-end md:items-center justify-center" onClick={()=>setChannelOpen(false)}>
   <div dir="rtl" className="w-full md:max-w-md rounded-t-3xl md:rounded-2xl bg-[var(--surface)] border app-border shadow-2xl p-4" onClick={e=>e.stopPropagation()}>
    <div className="flex items-center justify-between"><div><b>ایجاد گروه / کانال</b><div className="text-xs app-muted mt-1">مثل یک گفت‌وگوی گروهی سازمانی</div></div><button className="icon-btn" onClick={()=>setChannelOpen(false)}><X size={17}/></button></div>
    <input value={channelTitle} onChange={e=>setChannelTitle(e.target.value)} placeholder="نام گروه یا کانال" className="w-full min-h-11 rounded-xl border app-border bg-transparent px-3 mt-4 outline-none"/>
    <div className="grid grid-cols-2 gap-2 mt-3">
     <button onClick={()=>setChannelType("company_channel")} className={"min-h-11 rounded-xl border app-border text-xs "+(channelType==="company_channel"?"bg-[var(--primary)] text-white":"")}>کانال داخلی</button>
     <button onClick={()=>setChannelType("group")} className={"min-h-11 rounded-xl border app-border text-xs "+(channelType==="group"?"bg-[var(--primary)] text-white":"")}>گروه</button>
     <button onClick={()=>setChannelType("shared_company")} disabled={!sharedConnections.length} className={"min-h-11 rounded-xl border app-border text-xs "+(channelType==="shared_company"?"bg-[var(--primary)] text-white":"")}>شرکت مشترک</button>
    </div>
    {channelType==="shared_company"&&<select value={selectedConnection} onChange={e=>setSelectedConnection(e.target.value)} className="w-full min-h-11 rounded-xl border app-border bg-transparent px-3 mt-3"><option value="">انتخاب سازمان متصل</option>{sharedConnections.map(x=><option key={x.id} value={x.id}>{x.target_name}</option>)}</select>}
    <button disabled={!channelTitle.trim()} onClick={()=>void createChannel()} className="w-full min-h-11 rounded-xl bg-[var(--primary)] text-white font-bold mt-4 disabled:opacity-40">ایجاد</button>
   </div>
  </div>}

  <VoiceCallPanel controller={voice}/>

  {error&&<div className="fixed bottom-4 left-3 right-3 md:left-4 md:right-auto z-[700] max-w-md rounded-2xl border app-border bg-[var(--surface)] p-3 shadow-xl text-sm">{error}<button className="block text-xs mt-2 app-muted" onClick={()=>setError(null)}>بستن</button></div>}
 </div>;

};
