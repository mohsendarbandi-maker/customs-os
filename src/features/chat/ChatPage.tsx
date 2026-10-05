import{useSearchParams}from'react-router-dom';
import React,{useCallback,useEffect,useMemo,useRef,useState}from'react';
import{ArrowRight,Bell,BellOff,Bot,Check,CheckCheck,Hash,Mic,MicOff,MoreVertical,PackageCheck,Paperclip,Phone,Pin,Plus,Search,Send,Settings,Star,Trash2,UserPlus,UserRound,Users,Wifi,WifiOff,X}from'lucide-react';
import{useAuth}from'../../context/AuthContext';
import{normalizeFaText}from'../../lib/jalali';
import{makeClientId}from'../../lib/clientId';
import{enableChatPush,hasChatPushSubscription}from'./push';
import{addConversationMember,createConversation,createDirectConversation,deleteForAll,deleteForMe,editChatMessage,forwardChatMessage,listConversations,listMessages,listOrgConnections,markRead,searchChat,sendFileMessage,sendMessage,setMessageMentions,shareShipmentUpdate,toggleChatPin,toggleChatReaction,toggleChatStar}from'./api';
import { recognize } from 'tesseract.js';
import{supabase}from'../../lib/supabase';
import type{ChatConversation,ChatMessage}from'./types';
import {ChatBrandLogo} from './ChatBrandLogo';
import {ChatHierarchyPanel} from './ChatHierarchyPanel';
import {parseRealtimeMessage,parseRealtimeReaction,parseRealtimeRead,parseRealtimeTyping}from'./realtimeProtocol';
import {useVoiceCall} from './voiceCall';
import {VoiceCallPanel} from './VoiceCallPanel';
import {ChatSettingsPanel} from './ChatSettingsPanel';
const ChatAIOperatorPanel=React.lazy(async()=>{const mod=await import('../../components/AIOperatorPanel');return{default:mod.AIOperatorPanel};});

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
 const[reply,setReply]=useState<ChatMessage|null>(null),[editId,setEditId]=useState<string|null>(null),[forwardId,setForwardId]=useState<string|null>(null),[shipmentUpdateOpen,setShipmentUpdateOpen]=useState(false),[shipmentStatus,setShipmentStatus]=useState('در حال بررسی'),[shipmentNote,setShipmentNote]=useState(''),[peopleMode,setPeopleMode]=useState<'direct'|'member'>('direct'),[channelOpen,setChannelOpen]=useState(false),[channelTitle,setChannelTitle]=useState(''),[channelType,setChannelType]=useState<'group'|'company_channel'|'shared_company'>('company_channel'),[sharedConnections,setSharedConnections]=useState<Array<{id:string,target_organization_id:string,target_name:string}>>([]),[selectedConnection,setSelectedConnection]=useState(''),[attachmentBusy,setAttachmentBusy]=useState(false),[recording,setRecording]=useState(false),[ocrBusy,setOcrBusy]=useState(false),[pushReady,setPushReady]=useState(false),[pushBusy,setPushBusy]=useState(false),[settingsOpen,setSettingsOpen]=useState(false);
 const[menu,setMenu]=useState<string|null>(null);
 const bottom=useRef<HTMLDivElement|null>(null);const fileInput=useRef<HTMLInputElement|null>(null);const recorderRef=useRef<MediaRecorder|null>(null);const streamRef=useRef<MediaStream|null>(null);const voiceChunks=useRef<Blob[]>([]);
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
  if(!selectedId||!user?.id)return;
  void load(selectedId);
  if(channel.current)void supabase.removeChannel(channel.current);
  if(pollTimer.current!==null)window.clearTimeout(pollTimer.current);
  pollDelay.current=15000;
  setRealtimeState('connecting');
  setTypingUsers([]);

  const ch=supabase.channel('chat:'+selectedId,{config:{private:true,broadcast:{self:false,ack:true},presence:{key:user.id}}});
  ch.on('broadcast',{event:'message:new'},payload=>{const parsed=parseRealtimeMessage(payload.payload);if(parsed?.conversation_id===selectedId){void load(selectedId);void refresh()}});
  ch.on('broadcast',{event:'message:update'},payload=>{const parsed=parseRealtimeMessage(payload.payload);if(parsed?.conversation_id===selectedId){void load(selectedId)}});
  ch.on('broadcast',{event:'reaction:change'},payload=>{if(parseRealtimeReaction(payload.payload)!==null){void load(selectedId)}});
  ch.on('broadcast',{event:'read'},payload=>{if(parseRealtimeRead(payload.payload)!==null){void load(selectedId)}});
  ch.on('broadcast',{event:'typing'},payload=>{const parsed=parseRealtimeTyping(payload.payload);if(!parsed||parsed.user_id===user.id)return;setTypingUsers(previous=>{const next=new Set(previous);if(parsed.typing)next.add(parsed.user_id);else next.delete(parsed.user_id);return [...next]})});
  ch.on('presence',{event:'sync'},()=>{const state=ch.presenceState<PresenceUser>();const onlineUsers:string[]=[];for(const entries of Object.values(state)){for(const entry of entries){if(entry.user_id&&entry.user_id!==user.id)onlineUsers.push(entry.user_id)}}setTypingUsers(previous=>previous.filter(id=>onlineUsers.includes(id))) });
  ch.subscribe(async status=>{if(status==='SUBSCRIBED'){setRealtimeState('subscribed');pollDelay.current=30000;await ch.track({user_id:user.id,typing:false,at:Date.now()})}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){setRealtimeState('degraded')}});
  channel.current=ch;
  schedulePoll(selectedId,5000);
  return()=>{if(pollTimer.current!==null)window.clearTimeout(pollTimer.current);void supabase.removeChannel(ch);channel.current=null};
 },[selectedId,user?.id,load,refresh,schedulePoll]);

 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'})},[messages,selectedId]);
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

 const resolveMentionUserIds=useCallback(async(body:string):Promise<string[]>=>{const matches=Array.from(body.matchAll(/@([^\\s@]{1,50})/g));if(!matches.length||!profile?.organization_id)return [];const{data,error:e}=await supabase.from('profiles').select('id,full_name').eq('organization_id',profile.organization_id).eq('is_active',true);if(e)throw e;const tokens=new Set(matches.map(match=>normalizeFaText(match[1]??'').trim().toLocaleLowerCase('fa-IR')).filter(Boolean));const ids=new Set<string>();for(const person of data??[]){const first=normalizeFaText(person.full_name).trim().split(/\\s+/u)[0]?.toLocaleLowerCase('fa-IR');if(first&&tokens.has(first))ids.add(person.id)}return [...ids]},[profile?.organization_id]);
 const send=async()=>{
  const body=normalizeFaText(text);if(!body||!selectedId||sending)return;
  if(editId){await editCurrent();return}
  setSending(true);broadcastTyping(false);
  const clientUuid=makeClientId();
  const optimistic:ChatMessage={id:'optimistic-'+clientUuid,organization_id:profile?.organization_id??'',conversation_id:selectedId,sender_id:user?.id??'',client_uuid:clientUuid,message_type:'text',body,reply_to_message_id:reply?.id??null,forwarded_from_message_id:null,thread_root_message_id:null,delivery_status:'sending',edited_at:null,deleted_at:null,deleted_for_all_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  setMessages(v=>[...v,optimistic]);setText('');setReply(null);
  try{const result=await sendMessage(selectedId,clientUuid,body,reply?.id);setMessages(v=>v.filter(m=>m.id!==optimistic.id));if('queued'in result&&result.queued)setMessages(v=>[...v,{...optimistic,delivery_status:'queued'}]);else{const mentionIds=await resolveMentionUserIds(body);if(mentionIds.length)await setMessageMentions(result.id,mentionIds);await load(selectedId);await refresh()}}
  catch(e){setMessages(v=>v.filter(m=>m.id!==optimistic.id));setText(body);setError(err(e))}finally{setSending(false)}
 };
 const runSearch=async()=>{if(!query.trim()){setResults([]);return}try{setResults(await searchChat(query,selectedId??undefined))}catch(e){setError(err(e))}};
 const react=async(m:ChatMessage,emoji:string)=>{try{await toggleChatReaction(m.id,emoji);if(selectedId)await load(selectedId);setMenu(null)}catch(e){setError(err(e))}};
 const remove=async(m:ChatMessage,all:boolean)=>{try{if(all)await deleteForAll(m.id);else await deleteForMe(m.id);setMenu(null);if(selectedId)await load(selectedId)}catch(e){setError(err(e))}};
 const editCurrent=async()=>{if(!editId||!selectedId)return;const body=normalizeFaText(text);if(!body)return;try{await editChatMessage(editId,body);setEditId(null);setText('');await load(selectedId)}catch(e){setError(err(e))}};
 const forwardCurrent=async(targetId:string)=>{if(!forwardId)return;try{await forwardChatMessage(forwardId,targetId);setForwardId(null);if(selectedId)await load(selectedId);await refresh();setError('پیام ارسال شد.')}catch(e){setError(err(e))}};
 const publishShipmentUpdate=async()=>{if(!selectedId||!selected?.shipment_id)return;try{await shareShipmentUpdate(selectedId,selected.shipment_id,shipmentStatus,shipmentNote.trim()||undefined);setShipmentUpdateOpen(false);setShipmentNote('');await load(selectedId);await refresh()}catch(e){setError(err(e))}};
 const selected=conversations.find(c=>c.conversation_id===selectedId)??null;
 const voice=useVoiceCall({userId:user?.id,organizationId:profile?.organization_id,conversationId:selected?.conversation_id??null,peerUserId:selected?.type==='direct'?selected.display_user_id??null:null,peerName:selected?.display_name||selected?.title||'همکار',requestedCallId});
 useEffect(()=>{if(voice.error)setError(voice.error)},[voice.error]);
 const unread=useMemo(()=>conversations.reduce((n,c)=>n+Number(c.unread_count??0),0),[conversations]);
 const messageMap=useMemo(()=>new Map(messages.map(m=>[m.id,m])),[messages]);
 const filteredPeople=useMemo(()=>{
  const q=normalizeFaText(personQuery).toLowerCase();
  return people.filter(person=>person.id!==user?.id&&!q||person.id!==user?.id&&(normalizeFaText(person.full_name).toLowerCase().includes(q)||(person.phone??'').includes(q)));
 },[people,personQuery,user?.id]);

 return <div dir="rtl" className="chat-standalone w-full h-dvh min-h-[560px] flex flex-col gap-0 bg-[var(--surface)]" data-chat-wallpaper="plain">
  <nav className="chat-action-bar shrink-0 border-b app-border bg-[var(--surface)]" aria-label="ابزارهای چت">
   <div className="chat-action-scroll">
    <button type="button" onClick={()=>void openPeople("direct")} className="chat-action-item"><Plus size={19}/><span>پیام جدید</span></button>
    <button type="button" onClick={()=>{if(selected?.type==="direct"&&voice.canCall)void voice.startCall();else void openPeople("direct")}} className="chat-action-item"><Phone size={19}/><span>تماس</span></button>
    <button type="button" onClick={()=>{setChannelType("group");setChannelOpen(true)}} className="chat-action-item"><Users size={19}/><span>گروه</span></button>
    <button type="button" onClick={()=>{setChannelType("company_channel");setChannelOpen(true)}} className="chat-action-item"><Hash size={19}/><span>کانال</span></button>
    <button type="button" onClick={()=>{
      const owner=conversations.find(c=>c.hierarchy_kind==="owner_group");
      if(owner)setSelectedId(owner.conversation_id);else setError("برای این حساب هنوز گروه صاحب کالا ساخته نشده است.");
    }} className="chat-action-item"><Users size={19}/><span>صاحب کالا</span></button>
    <button type="button" onClick={()=>document.querySelector<HTMLButtonElement>(".ai-operator-launcher")?.click()} className="chat-action-item"><Bot size={19}/><span>هوش مصنوعی</span></button>
    <button type="button" onClick={()=>setSettingsOpen(true)} className="chat-action-item"><Settings size={19}/><span>تنظیمات</span></button>
   </div>
  </nav>
  <div className="chat-content flex flex-1 min-h-0 gap-0 md:gap-3">
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
   <ChatHierarchyPanel selectedId={selectedId} onSelect={id=>{setSelectedId(id);setMessages([]);setResults([]);setMenu(null)}} fallback={conversations}/>
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
     {selected?.shipment_id&&<button type="button" className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" onClick={()=>setShipmentUpdateOpen(true)} aria-label="وضعیت محموله"><PackageCheck size={17}/></button>}
     {selected&&(selected.type==="group"||selected.type==="company_channel")&&<button className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" title="افزودن عضو" onClick={()=>void openPeople("member")}><UserPlus size={16}/></button>}
     {selected.type==="direct"&&selected.display_user_id&&voice.canCall&&<button className="h-12 w-12 shrink-0 rounded-full flex items-center justify-center text-white bg-[var(--primary)] hover:opacity-90 shadow-sm" title="تماس صوتی زنده" aria-label="تماس صوتی زنده" onClick={()=>void voice.startCall()}><Phone size={19}/></button>}
     <button className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" title={pushReady?"اعلان‌های پیام فعال است":"فعال‌سازی اعلان پیام"} onClick={()=>void enablePush()} disabled={pushBusy}>{pushReady?<Bell size={17}/>:<BellOff size={17}/>}</button>
     {online&&realtimeState==="subscribed"?<Wifi size={16}/>:<WifiOff size={16}/>}
    </header>

    {results.length>0&&<div className="border-b app-border px-3 py-2 max-h-40 overflow-y-auto">{results.map(r=><button key={r.id} className="block w-full text-right p-2 rounded-lg hover:bg-black/5" onClick={()=>setResults([])}><b className="text-sm">{r.title}</b><div className="text-xs app-muted truncate">{r.snippet}</div></button>)}</div>}

    <div className="chat-message-area flex-1 min-h-0 overflow-y-auto px-3 py-5 md:px-5 md:py-6 overscroll-contain bg-[radial-gradient(circle_at_20%_20%,rgba(0,0,0,.03),transparent_20%),radial-gradient(circle_at_80%_80%,rgba(0,0,0,.025),transparent_18%)] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,.03),transparent_20%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,.02),transparent_18%)]">
     {messages.map((m,index)=>{
      const own=m.sender_id===user?.id;const deleted=Boolean(m.deleted_for_all_at);const previous=messages[index-1];const showDay=!previous||dayKey(previous.created_at)!==dayKey(m.created_at);const quoted=m.reply_to_message_id?messageMap.get(m.reply_to_message_id):null;
      return <React.Fragment key={m.id}>
       {showDay&&<div className="flex justify-center my-3"><span className="px-3 py-1 rounded-full bg-black/5 dark:bg-white/10 text-[10px] app-muted shadow-sm">{dayLabel(m.created_at)}</span></div>}
       <div className={"flex mb-1.5 "+(own?"justify-start":"justify-end")}>
        <div className="max-w-[88%] md:max-w-[72%]">
         <div className={"relative rounded-2xl px-4 py-2.5 shadow-sm "+(own?"bg-[var(--primary)] text-white rounded-br-md":"bg-black/5 dark:bg-white/10 rounded-bl-md")}>
          {!own&&selected.type!=="direct"&&m.sender_name&&<div className={"text-[10px] font-bold mb-1 "+(own?"opacity-80":"app-muted")}>{m.sender_name}</div>}
          {quoted&&<button className={"w-full text-right mb-2 px-2 py-1 rounded-lg border border-current/20 text-[10px] opacity-80"} onClick={()=>{const el=document.getElementById("msg-"+quoted.id);el?.scrollIntoView({behavior:"smooth",block:"center"})}}>{quoted.body||'پیام پیوست‌دار'}</button>}
          {deleted?<div className="text-sm italic opacity-80">این پیام حذف شده است.</div>:m.body&&<div className="chat-message-text text-[17px] leading-8 whitespace-pre-wrap break-words">{m.body}</div>}
          {!deleted&&(m.attachments??[]).map(a=>a.security_status==="clean"&&a.url?(a.mime_type.startsWith("audio/")?<audio key={a.id} controls src={a.url} className="mt-2 w-full max-w-[280px]"/>:<a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 rounded-xl bg-black/10 dark:bg-white/10 px-3 py-2 text-xs underline"><Paperclip size={14}/><span className="truncate">{a.original_name}</span></a>):<div key={a.id} className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs">{a.security_status==="blocked"?"فایل مسدود شد.":"فایل در حال بررسی امنیتی است…"}</div>)}
          {(m.reactions??[]).length>0&&<div className="flex flex-wrap gap-1 mt-2">{Array.from(new Set((m.reactions??[]).map(r=>r.emoji))).map(emoji=><button type="button" key={emoji} onClick={()=>void react(m,emoji)} className="rounded-full px-2 py-1 text-[11px] bg-black/10 dark:bg-white/10">{emoji} {((m.reactions??[]).filter(r=>r.emoji===emoji)).length}</button>)}</div>}
          <div className={"flex items-center justify-end gap-1 mt-1 text-[11px] "+(own?"text-white/75":"app-muted")}>
           {m.edited_at&&<span>ویرایش‌شده</span>}<span>{chatTime(m.created_at)}</span>
           {own&&(m.delivery_status==='sent'?<Check size={12}/>:m.delivery_status==='delivered'||m.delivery_status==='read'?<CheckCheck size={13}/>:<span className="opacity-70">در حال ارسال</span>)}
           {!deleted&&<button onClick={()=>setMenu(menu===m.id?null:m.id)} aria-label="گزینه‌های پیام"><MoreVertical size={14}/></button>}
          </div>
          {menu===m.id&&<div className="absolute z-20 left-1 bottom-7 rounded-2xl border app-border bg-[var(--surface)] text-[var(--text)] shadow-xl p-1 min-w-48">
           <div className="flex gap-1 p-1 border-b app-border">{['❤️','👍','😂','😮','😢','🔥'].map(emoji=><button type="button" key={emoji} onClick={()=>void react(m,emoji)} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10" aria-label={emoji}>{emoji}</button>)}</div>
           <button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>{setReply(m);setMenu(null)}}>پاسخ</button>
           {own&&<button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>{setEditId(m.id);setText(m.body??'');setReply(null);setMenu(null)}}>ویرایش</button>}
           <button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>void toggleChatStar(m.id).then(()=>{setMenu(null);return selectedId?load(selectedId):Promise.resolve()}).catch(e=>setError(err(e)))}><Star size={13} className="inline ml-1"/>ستاره</button>
           <button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>void toggleChatPin(m.id).then(()=>{setMenu(null);return selectedId?load(selectedId):Promise.resolve()}).catch(e=>setError(err(e)))}><Pin size={13} className="inline ml-1"/>سنجاق</button>
           <button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>{setForwardId(m.id);setMenu(null)}}>ارسال مجدد</button>
           <button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>void remove(m,false)}><Trash2 size={13} className="inline ml-1"/>حذف برای من</button>
           {own&&<button type="button" className="w-full text-right px-3 py-2 text-xs text-red-600" onClick={()=>void remove(m,true)}>حذف برای همه</button>}
          </div>}
         </div>
        </div>
       </div>
      </React.Fragment>
     })}
     <div ref={bottom}/>
    </div>

    {(reply||editId)&&<div className="mx-2 md:mx-3 mb-1 rounded-xl border app-border bg-black/5 dark:bg-white/5 p-2 flex gap-2 items-center"><div className="w-1 self-stretch rounded-full bg-[var(--primary)]"/><div className="flex-1 min-w-0 text-xs truncate">{editId?'در حال ویرایش پیام':'پاسخ به: '+(reply?.body||'پیام پیوست‌دار')}</div><button type="button" className="icon-btn" onClick={()=>{setReply(null);setEditId(null);setText('')}} aria-label="لغو"><X size={15}/></button></div>}

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
  </div>

  <React.Suspense fallback={null}><ChatAIOperatorPanel pageContext="chat — آمار محموله‌ها، پرونده‌ها و عملیات سازمانی"/></React.Suspense>
  <ChatSettingsPanel open={settingsOpen} onClose={()=>setSettingsOpen(false)}/>

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

  {forwardId&&<div className="fixed inset-0 z-[620] bg-black/45 flex items-end md:items-center justify-center" onClick={()=>setForwardId(null)}>
   <div dir="rtl" className="w-full md:max-w-lg max-h-[82vh] overflow-hidden rounded-t-3xl md:rounded-2xl bg-[var(--surface)] border app-border shadow-2xl" onClick={e=>e.stopPropagation()}>
    <div className="p-4 border-b app-border flex items-center justify-between"><b>ارسال مجدد پیام</b><button type="button" onClick={()=>setForwardId(null)}><X size={16}/></button></div>
    <div className="max-h-[60vh] overflow-y-auto p-2">{conversations.filter(c=>c.conversation_id!==selectedId).map(c=><button type="button" key={c.conversation_id} onClick={()=>void forwardCurrent(c.conversation_id)} className="w-full min-h-[62px] rounded-xl px-3 py-2 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5"><div className="h-10 w-10 rounded-full bg-[var(--primary)] text-white flex items-center justify-center">{c.type==='company_channel'?<Hash size={16}/>:<Users size={16}/>}</div><div className="min-w-0 flex-1"><b className="block truncate text-sm">{title(c)}</b><span className="block truncate text-xs app-muted mt-1">{c.last_message_body||'گفتگو'}</span></div></button>)}</div>
   </div>
  </div>}

  {shipmentUpdateOpen&&selected?.shipment_id&&<div className="fixed inset-0 z-[630] bg-black/45 flex items-end md:items-center justify-center" onClick={()=>setShipmentUpdateOpen(false)}>
   <div dir="rtl" className="w-full md:max-w-md rounded-t-3xl md:rounded-2xl bg-[var(--surface)] border app-border shadow-2xl p-4" onClick={e=>e.stopPropagation()}>
    <div className="flex items-center justify-between"><div><b>به‌روزرسانی محموله</b><div className="text-xs app-muted mt-1">{selected.shipment_bl_number||selected.shipment_display_name||'محموله'}</div></div><button type="button" onClick={()=>setShipmentUpdateOpen(false)}><X size={16}/></button></div>
    <select value={shipmentStatus} onChange={e=>setShipmentStatus(e.target.value)} className="w-full h-11 rounded-xl border app-border bg-transparent px-3 mt-4">{['در انتظار','در حال بررسی','در مسیر','رسیده به بندر','در گمرک','ترخیص شده','تحویل شده','تاخیر'].map(status=><option key={status} value={status}>{status}</option>)}</select>
    <textarea value={shipmentNote} onChange={e=>setShipmentNote(e.target.value)} placeholder="توضیح وضعیت" rows={4} className="w-full mt-3 rounded-xl border app-border bg-transparent p-3 outline-none text-sm resize-none"/>
    <button type="button" onClick={()=>void publishShipmentUpdate()} className="w-full h-11 rounded-xl bg-[var(--primary)] text-white font-bold mt-3">ارسال وضعیت در کانال محموله</button>
   </div>
  </div>}

  <VoiceCallPanel controller={voice}/>

  {error&&<div className="fixed bottom-4 left-3 right-3 md:left-4 md:right-auto z-[700] max-w-md rounded-2xl border app-border bg-[var(--surface)] p-3 shadow-xl text-sm">{error}<button className="block text-xs mt-2 app-muted" onClick={()=>setError(null)}>بستن</button></div>}
 </div>;

};
