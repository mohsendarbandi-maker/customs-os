import React,{useCallback,useEffect,useMemo,useRef,useState}from'react';
import{AlertCircle,ArrowRight,Bell,BellOff,Check,CheckCheck,ChevronDown,Clock,Hash,Loader2,Mic,MicOff,MoreVertical,PackageCheck,Paperclip,Phone,Pin,Plus,Search,Send,Star,Trash2,UserPlus,UserRound,Users,Wifi,WifiOff,X}from'lucide-react';
import{useSearchParams}from'react-router-dom';
import{useAuth}from'../../context/AuthContext';
import{normalizeFaText}from'../../lib/jalali';
import{makeClientId}from'../../lib/clientId';
import{subscribeOfflineQueue,flushOfflineQueue,isChatQueueItem,chatClientUuid,retryChatMessage,type QueuedRpc}from'../../lib/offlineQueue';
import{enableChatPush,hasChatPushSubscription}from'./push';
import{addConversationMember,createConversation,createDirectConversation,deleteForAll,deleteForMe,editChatMessage,forwardChatMessage,listConversations,getMessageById,listMessageReceipts,listMessages,listMessagesAfter,listOrgConnections,markChatFocus,markDelivered,markPlayed,markRead,clearChatFocus,searchChat,sendFileMessage,sendMessage,setMessageMentions,shareShipmentUpdate,toggleChatPin,toggleChatReaction,toggleChatStar}from'./api';
import{supabase}from'../../lib/supabase';
import type{ChatConversation,ChatMessage}from'./types';
import{ChatBrandLogo}from'./ChatBrandLogo';
import{ChatHierarchyPanel}from'./ChatHierarchyPanel';
import{ChatQuickNav,ChatDirectoryPanel,type ChatDirectoryMode}from'./ChatQuickNav';
import{parseRealtimeMessage,parseRealtimeReaction,parseRealtimeRead,parseRealtimeTyping}from'./realtimeProtocol';
import{useVoiceCall}from'./voiceCall';
import{VoiceCallPanel}from'./VoiceCallPanel';
import{ChatSettingsPanel}from'./ChatSettingsPanel';
import{CustomsAIOperatorPanel as ChatAIOperatorPanel}from'../../components/AIOperatorPanel';

type Person={id:string;full_name:string;phone:string|null;role:string};
type ChatFolder='all'|'coworkers'|'groups'|'owners'|'shipments'|'unread';
type MediaState='idle'|'preparing'|'uploading'|'committed'|'recording';
type RealtimeState='offline'|'connecting'|'syncing'|'ready'|'degraded';

const err=(e:unknown)=>e instanceof Error?e.message:'عملیات چت انجام نشد. دوباره تلاش کنید.';
const title=(c:ChatConversation)=>c.display_name||c.title||(c.type==='direct'?'گفتگوی مستقیم':c.type==='shared_company'?'گفتگوی مشترک شرکت‌ها':c.type==='company_channel'?'کانال سازمان':'گفتگو');
const chatTime=(value:string|null)=>value?new Intl.DateTimeFormat('fa-IR-u-ca-persian',{timeZone:'Asia/Tehran',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'';
const dayKey=(value:string)=>new Intl.DateTimeFormat('fa-IR-u-ca-persian',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const dayLabel=(value:string)=>{
 const target=dayKey(value),today=dayKey(new Date().toISOString());const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
 if(target===today)return'امروز';if(target===dayKey(yesterday.toISOString()))return'دیروز';
 return new Intl.DateTimeFormat('fa-IR-u-ca-persian',{timeZone:'Asia/Tehran',weekday:'long',day:'numeric',month:'long'}).format(new Date(value));
};

const localMessage=(item:QueuedRpc):ChatMessage|null=>{
 if(!isChatQueueItem(item))return null;
 const clientUuid=chatClientUuid(item);if(!clientUuid)return null;
 const state=item.state==='failed'?'failed':item.state==='sending'?'sending':'queued';
 return{
  id:'local-'+clientUuid,
  organization_id:String(item.args.p_organization_id||''),
  conversation_id:String(item.args.p_conversation_id),
  sender_id:item.userId,
  client_uuid:clientUuid,
  message_type:String(item.args.p_message_type||'text'),
  body:typeof item.args.p_body==='string'?item.args.p_body:null,
  reply_to_message_id:typeof item.args.p_reply_to_message_id==='string'?item.args.p_reply_to_message_id:null,
  forwarded_from_message_id:null,thread_root_message_id:null,
  delivery_status:state,edited_at:null,deleted_at:null,deleted_for_all_at:null,
  created_at:item.createdAt,updated_at:item.createdAt,
 };
};

const mergeMessages=(current:ChatMessage[],incoming:ChatMessage[],queue:QueuedRpc[]=[]):ChatMessage[]=>{
 const map=new Map<string,ChatMessage>();
 for(const message of current)map.set(message.id,message);
 for(const message of incoming){
  map.delete('local-'+message.client_uuid);
  map.set(message.id,message);
 }
 for(const item of queue){
  const local=localMessage(item);if(!local)continue;
  if([...map.values()].some(message=>message.client_uuid===local.client_uuid&&!message.id.startsWith('local-')))continue;
  map.set(local.id,local);
 }
 return[...map.values()].sort((a,b)=>{
  const created=new Date(a.created_at).getTime()-new Date(b.created_at).getTime();
  return created||a.id.localeCompare(b.id);
 });
};

class ChatFeatureBoundary extends React.Component<{children:React.ReactNode}, {failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return{failed:true};}
 componentDidCatch(){/* Non-critical chat features must not bring down ChatPage. */}
 render(){return this.state.failed?null:this.props.children;}
}

export const ChatPage:React.FC=()=>{
 const{user,profile}=useAuth();const[searchParams]=useSearchParams();
 const requestedConversationId=searchParams.get('conversation');const requestedCallId=searchParams.get('call');
 const[conversations,setConversations]=useState<ChatConversation[]>([]);const[selectedId,setSelectedId]=useState<string|null>(null);
 const[messages,setMessages]=useState<ChatMessage[]>([]);const[queueItems,setQueueItems]=useState<QueuedRpc[]>([]);
 const messagesRef=useRef<ChatMessage[]>([]);const selectedIdRef=useRef<string|null>(null);
 const[text,setText]=useState('');const[error,setError]=useState<string|null>(null);
 const[loading,setLoading]=useState(true);const[online,setOnline]=useState(()=>navigator.onLine);
 const[realtimeState,setRealtimeState]=useState<RealtimeState>(()=>navigator.onLine?'connecting':'offline');
 const[typingUsers,setTypingUsers]=useState<string[]>([]);const[people,setPeople]=useState<Person[]>([]);
 const[peopleOpen,setPeopleOpen]=useState(false);const[personQuery,setPersonQuery]=useState('');
 const[query,setQuery]=useState('');const[results,setResults]=useState<Array<{kind:string;id:string;conversation_id:string;title:string;snippet:string;created_at:string}>>([]);
 const[reply,setReply]=useState<ChatMessage|null>(null);const[editId,setEditId]=useState<string|null>(null);const[forwardId,setForwardId]=useState<string|null>(null);
 const[shipmentUpdateOpen,setShipmentUpdateOpen]=useState(false);const[shipmentStatus,setShipmentStatus]=useState('در حال بررسی');const[shipmentNote,setShipmentNote]=useState('');
 const[peopleMode,setPeopleMode]=useState<'direct'|'member'>('direct');const[channelOpen,setChannelOpen]=useState(false);const[channelTitle,setChannelTitle]=useState('');
 const[channelType,setChannelType]=useState<'group'|'company_channel'|'shared_company'>('company_channel');const[sharedConnections,setSharedConnections]=useState<Array<{id:string;target_organization_id:string;target_name:string}>>([]);
 const[selectedConnection,setSelectedConnection]=useState('');const[attachmentBusy,setAttachmentBusy]=useState(false);const[mediaState,setMediaState]=useState<MediaState>('idle');
 const[recording,setRecording]=useState(false);const[ocrBusy,setOcrBusy]=useState(false);const[pushReady,setPushReady]=useState(false);const[pushBusy,setPushBusy]=useState(false);const[settingsOpen,setSettingsOpen]=useState(false);
 const[menu,setMenu]=useState<string|null>(null);const[directoryOpen,setDirectoryOpen]=useState(false);const[directoryMode,setDirectoryMode]=useState<ChatDirectoryMode>('members');
 const[folder,setFolder]=useState<ChatFolder>('all');const[newMessageCount,setNewMessageCount]=useState(0);
 const[olderLoading,setOlderLoading]=useState(false);const[hasOlder,setHasOlder]=useState(true);
 const[realtimeReady,setRealtimeReady]=useState(false);
 const channel=useRef<ReturnType<typeof supabase.channel>|null>(null);const inboxChannel=useRef<ReturnType<typeof supabase.channel>|null>(null);
 const messageArea=useRef<HTMLDivElement|null>(null);const bottom=useRef<HTMLDivElement|null>(null);
 const fileInput=useRef<HTMLInputElement|null>(null);const recorderRef=useRef<MediaRecorder|null>(null);const streamRef=useRef<MediaStream|null>(null);const voiceChunks=useRef<Blob[]>([]);
 const typingTimer=useRef<number|null>(null);const lastTypingSent=useRef(0);const readTimer=useRef<number|null>(null);const readIndexRef=useRef(-1);
 const queueSyncRef=useRef(queueItems);const latestMessageRef=useRef<ChatMessage|null>(null);const nearBottomRef=useRef(true);const pendingScrollMessage=useRef<string|null>(null);
 const olderLoadingRef=useRef(false);const flushBusyRef=useRef(false);

 useEffect(()=>{queueSyncRef.current=queueItems},[queueItems]);
 useEffect(()=>{messagesRef.current=messages},[messages]);
 useEffect(()=>{selectedIdRef.current=selectedId},[selectedId]);
 useEffect(()=>{latestMessageRef.current=[...messages].filter(m=>!m.id.startsWith('local-')).pop()??latestMessageRef.current},[messages]);

 const refresh=useCallback(async()=>{
  try{setConversations(await listConversations())}catch(e){setError(err(e))}finally{setLoading(false)}
 },[]);

 const scrollBottom=useCallback((smooth=true)=>{
  requestAnimationFrame(()=>bottom.current?.scrollIntoView({behavior:smooth?'smooth':'auto',block:'end'}));
 },[]);

 const loadConversation=useCallback(async(id:string,initial=true)=>{
  try{
   const data=await listMessages(id);
   const ordered=[...data].reverse();
   setMessages(previous=>mergeMessages(initial?[]:previous,ordered,queueSyncRef.current.filter(item=>String(item.args.p_conversation_id)===id)));
   setHasOlder(data.length>=50);
   setLoading(false);
   if(initial){
    readIndexRef.current=-1;nearBottomRef.current=true;setNewMessageCount(0);
    requestAnimationFrame(()=>scrollBottom(false));
   }
  }catch(e){setError(err(e));setLoading(false)}
 },[scrollBottom]);

 const syncAfter=useCallback(async(id:string)=>{
  try{
   const last=[...messagesRef.current].reverse().find(m=>!m.id.startsWith('local-'));
   if(!last){await loadConversation(id,true);return 0;}
   const incoming=await listMessagesAfter(id,{createdAt:last.created_at,id:last.id});
   if(!incoming.length)return 0;
   setMessages(previous=>mergeMessages(previous,incoming,queueSyncRef.current.filter(item=>String(item.args.p_conversation_id)===id)));
   const inbound=incoming.filter(message=>message.sender_id!==user?.id);
   if(inbound.length)void Promise.all(inbound.slice(-20).map(message=>markDelivered(message.id).catch(()=>{})));
   if(!nearBottomRef.current){setNewMessageCount(count=>count+incoming.length)}else{scrollBottom(true)}
   return incoming.length;
  }catch(e){setError(err(e));return 0}
 },[loadConversation,scrollBottom,user?.id]);

 const flushChatOutbox=useCallback(async()=>{
  if(flushBusyRef.current)return;flushBusyRef.current=true;
  try{await flushOfflineQueue()}finally{flushBusyRef.current=false}
 },[]);

 useEffect(()=>{
  const unsubscribe=subscribeOfflineQueue(items=>{
   const chatItems=items.filter(isChatQueueItem);setQueueItems(chatItems);
   if(!selectedId)return;
   setMessages(previous=>mergeMessages(previous,[],chatItems.filter(item=>String(item.args.p_conversation_id)===selectedId)));
  });
  void flushChatOutbox();
  return()=>{unsubscribe()};
 },[flushChatOutbox,selectedId]);

 useEffect(()=>{
  if(!profile?.organization_id)return;
  void (async()=>{
    try{
      const {data}=await supabase.from('profiles').select('id,full_name,phone,role').eq('organization_id',profile.organization_id).eq('is_active',true).order('full_name');
      setPeople((data??[])as Person[]);
    }catch{setPeople([])}
  })();
  void listOrgConnections().then(setSharedConnections).catch(()=>setSharedConnections([]));
  void refresh();
  const on=()=>{setOnline(true);setRealtimeState('connecting');void flushChatOutbox();if(selectedId)void loadConversation(selectedId,false)};
  const off=()=>{setOnline(false);setRealtimeState('offline')};
  window.addEventListener('online',on);window.addEventListener('offline',off);
  return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off)};
 },[flushChatOutbox,loadConversation,profile?.organization_id,refresh,selectedId]);

 useEffect(()=>{
  if(!selectedId||!user?.id)return;
  let active=true;
  void markChatFocus(selectedId).catch(()=>{});
  const focusTimer=window.setInterval(()=>{if(document.visibilityState==='visible')void markChatFocus(selectedId).catch(()=>{})},30000);
  setRealtimeState(online?'connecting':'offline');setRealtimeReady(false);setTypingUsers([]);readIndexRef.current=-1;
  void loadConversation(selectedId,true);
  if(channel.current)void supabase.removeChannel(channel.current);
  void(async()=>{
   try{await supabase.realtime.setAuth()}catch{}
   const ch=supabase.channel('chat:'+selectedId,{config:{private:true,broadcast:{self:false,ack:true},presence:{key:user.id}}})
    .on('broadcast',{event:'message:new'},payload=>{const parsed=parseRealtimeMessage(payload.payload);if(parsed?.conversation_id===selectedId){void syncAfter(selectedId);void refresh();}})
    .on('broadcast',{event:'message:update'},payload=>{const parsed=parseRealtimeMessage(payload.payload);if(parsed?.conversation_id===selectedId){void syncAfter(selectedId);void refresh();}})
    .on('broadcast',{event:'reaction:change'},payload=>{if(parseRealtimeReaction(payload.payload))void loadConversation(selectedId,false)})
    .on('broadcast',{event:'receipt:change'},payload=>{const parsed=parseRealtimeRead(payload.payload);if(!parsed||parsed.user_id===user.id)return;void listMessageReceipts([parsed.message_id]).then(receipts=>{
      if(!active)return;
      setMessages(previous=>previous.map(message=>{
       if(message.id!==parsed.message_id)return message;
       const deliveryStatus=message.delivery_status==='read'||receipts.some(r=>r.status==='read')?'read':receipts.some(r=>r.status==='delivered')?'delivered':message.delivery_status;
       return{...message,delivery_status:deliveryStatus,receipts};
      }));
    }).catch(()=>{});})
    .on('broadcast',{event:'typing'},payload=>{const parsed=parseRealtimeTyping(payload.payload);if(!parsed||parsed.user_id===user.id)return;setTypingUsers(previous=>{const next=new Set(previous);parsed.typing?next.add(parsed.user_id):next.delete(parsed.user_id);return[...next]})})
    .on('presence',{event:'sync'},()=>{const state=ch.presenceState<PresenceUser>();const usersOnline:string[]=[];for(const entries of Object.values(state)){for(const entry of entries){if(entry.user_id&&entry.user_id!==user.id)usersOnline.push(entry.user_id)}}setTypingUsers(previous=>previous.filter(id=>usersOnline.includes(id)))})
    .subscribe(status=>{
     if(!active)return;
     if(status==='SUBSCRIBED'){
      setRealtimeState('syncing');setRealtimeReady(false);
      void Promise.all([syncAfter(selectedId),flushChatOutbox(),refresh()]).finally(()=>{if(active){setRealtimeState('ready');setRealtimeReady(true)}});void ch.track({user_id:user.id,typing:false,at:Date.now()});
     }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){setRealtimeState('degraded');setRealtimeReady(false)}
    });
   channel.current=ch;
  })();
  return()=>{active=false;window.clearInterval(focusTimer);void clearChatFocus().catch(()=>{});if(channel.current)void supabase.removeChannel(channel.current);channel.current=null};
 },[flushChatOutbox,loadConversation,online,refresh,selectedId,syncAfter,user?.id]);

 useEffect(()=>{
  if(!user?.id)return;
  let active=true;
  void(async()=>{
   try{await supabase.realtime.setAuth()}catch{}
   const ch=supabase.channel('chat-inbox-user:'+user.id,{config:{private:true,broadcast:{self:false}}})
    .on('broadcast',{event:'message:new'},payload=>{
     const parsed=parseRealtimeMessage(payload.payload);if(!parsed)return;
     if(parsed.sender_id!==user.id)void markDelivered(parsed.id).catch(()=>{});
     if(parsed.conversation_id===selectedIdRef.current)void syncAfter(parsed.conversation_id);
     void refresh();
    })
    .on('broadcast',{event:'message:update'},payload=>{
     const parsed=parseRealtimeMessage(payload.payload);if(!parsed)return;
     if(parsed.conversation_id===selectedId)void syncAfter(parsed.conversation_id);
     void refresh();
    })
    .on('broadcast',{event:'receipt:change'},payload=>{
     const parsed=parseRealtimeRead(payload.payload);if(!parsed||parsed.message_id===undefined)return;
     if(!selectedId)return;
     void listMessageReceipts([parsed.message_id]).then(receipts=>setMessages(previous=>previous.map(message=>{
      if(message.id!==parsed.message_id)return message;
      const status=receipts.some(r=>r.status==='read')?'read':receipts.some(r=>r.status==='delivered')?'delivered':message.delivery_status;
      return{...message,delivery_status:status,receipts};
     }))).catch(()=>{});
    })
    .subscribe(status=>{if(status==='SUBSCRIBED'){setRealtimeState(previous=>previous==='offline'?'offline':previous);void flushChatOutbox()}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){setRealtimeState(previous=>previous==='ready'?'degraded':previous)}});
   inboxChannel.current=ch;
  })();
  return()=>{active=false;if(inboxChannel.current)void supabase.removeChannel(inboxChannel.current);inboxChannel.current=null};
 },[flushChatOutbox,refresh,syncAfter,user?.id]);

 useEffect(()=>{
  if(!user?.id)return;
  const onVisibility=()=>{if(document.visibilityState==='visible'&&selectedId){void syncAfter(selectedId);void refresh()}};
  document.addEventListener('visibilitychange',onVisibility);return()=>document.removeEventListener('visibilitychange',onVisibility);
 },[refresh,selectedId,syncAfter]);

 useEffect(()=>{
  let alive=true;void hasChatPushSubscription().then(value=>{if(alive)setPushReady(value)}).catch(()=>{});return()=>{alive=false};
 },[]);

 const enablePush=async()=>{if(pushBusy)return;setPushBusy(true);try{await enableChatPush(true);setPushReady(true);setError('اعلان‌های چت برای این دستگاه فعال شد.')}catch(e){setError(err(e))}finally{setPushBusy(false)}};

 const broadcastTyping=useCallback((typing:boolean)=>{
  const ch=channel.current;if(!ch||!user?.id)return;const now=Date.now();
  if(typing&&now-lastTypingSent.current<500)return;lastTypingSent.current=now;
  void ch.send({type:'broadcast',event:'typing',payload:{user_id:user.id,typing}});
  if(typing&&typingTimer.current!==null)window.clearTimeout(typingTimer.current);
  if(typing)typingTimer.current=window.setTimeout(()=>broadcastTyping(false),1200);
 },[user?.id]);

 const openPeople=async(mode:'direct'|'member'='direct')=>{
  if(!profile?.organization_id)return;
  const{data,error:e}=await supabase.from('profiles').select('id,full_name,phone,role').eq('organization_id',profile.organization_id).eq('is_active',true).order('full_name');
  if(e){setError(err(e));return}setPeople((data??[])as Person[]);setPersonQuery('');setPeopleMode(mode);setPeopleOpen(true);
 };
 const newChat=async(id:string)=>{
  if(!id||id===user?.id)return;
  try{
   const conversation=await createDirectConversation(id);
   const conversationId='id' in conversation?conversation.id:conversation.conversation_id;
   if(!conversationId)throw new Error('گفتگوی مستقیم ایجاد نشد.');
   await refresh();
   setSelectedId(conversationId);
   setPeopleOpen(false);
   setDirectoryOpen(false);
  }catch(e){setError(err(e))}
};
 const openDirectory=(mode:ChatDirectoryMode)=>{setDirectoryMode(mode);setDirectoryOpen(true)};
 const addMember=async(id:string)=>{if(!selectedId)return;try{await addConversationMember(selectedId,id);setPeopleOpen(false);await refresh()}catch(e){setError(err(e))}};
 const createChannel=async()=>{
  const name=channelTitle.trim();if(!name)return;if(channelType==='shared_company'&&!selectedConnection){setError('برای کانال مشترک، سازمان متصل را انتخاب کنید.');return}
  try{const conn=sharedConnections.find(x=>x.id===selectedConnection);const c=await createConversation({type:channelType,title:name,sharedWithOrganizationId:conn?.target_organization_id??null,orgConnectionId:conn?.id??null});setChannelTitle('');setChannelOpen(false);await refresh();setSelectedId(c.id)}catch(e){setError(err(e))}
 };

 const chooseAttachment=async(file?:File)=>{
  if(!file||!selectedId||!profile?.organization_id||attachmentBusy)return;
  if(file.size>50*1024*1024){setError('حجم فایل بیش از ۵۰MB است.');return}
  setAttachmentBusy(true);setMediaState('preparing');
  try{
   setMediaState('uploading');await sendFileMessage(selectedId,profile.organization_id,file,'file');setMediaState('committed');
   if(file.type.startsWith('image/')){setOcrBusy(true);try{const ocr=await import('tesseract.js').then(module=>module.recognize(file,'fas+eng'));const ocrText=String(ocr.data?.text||'').trim();if(ocrText)setText(ocrText)}catch{}finally{setOcrBusy(false)}}
   await loadConversation(selectedId,false);await refresh();
  }catch(e){setError(err(e))}finally{setAttachmentBusy(false);setMediaState('idle')}
 };

 const toggleVoice=async()=>{
  if(!selectedId||!profile?.organization_id||attachmentBusy)return;
  if(recording){try{recorderRef.current?.stop()}catch{}return}
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError('ضبط صدا در این دستگاه در دسترس نیست.');return}
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   streamRef.current=stream;voiceChunks.current=[];const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x));
   const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);recorderRef.current=recorder;
   recorder.ondataavailable=e=>{if(e.data?.size)voiceChunks.current.push(e.data)};
   recorder.onstop=async()=>{
    try{
     setMediaState('preparing');stream.getTracks().forEach(t=>t.stop());const blob=new Blob(voiceChunks.current,{type:mime||'audio/mp4'});voiceChunks.current=[];recorderRef.current=null;streamRef.current=null;setRecording(false);
     if(blob.size<1000){setError('صدای قابل استفاده‌ای ضبط نشد.');return}
     setAttachmentBusy(true);setMediaState('uploading');const ext=(blob.type||'audio/mp4').includes('webm')?'webm':'mp4';
     await sendFileMessage(selectedId,profile.organization_id,new File([blob],`voice-${Date.now()}.${ext}`,{type:blob.type||'audio/mp4'}),'voice');
     setMediaState('committed');await loadConversation(selectedId,false);await refresh();
    }catch(e){setError(err(e))}finally{setAttachmentBusy(false);setMediaState('idle')}
   };
   recorder.start(250);setRecording(true);setMediaState('recording');
  }catch(e){setError(err(e))}
 };

 const resolveMentionUserIds=useCallback(async(body:string):Promise<string[]>=>{
  const matches=Array.from(body.matchAll(/@([^\s@]{1,50})/g));if(!matches.length||!profile?.organization_id)return[];
  const{data,error:e}=await supabase.from('profiles').select('id,full_name').eq('organization_id',profile.organization_id).eq('is_active',true);if(e)throw e;
  const tokens=new Set(matches.map(match=>normalizeFaText(match[1]??'').trim().toLocaleLowerCase('fa-IR')).filter(Boolean));const ids=new Set<string>();
  for(const person of data??[]){const first=normalizeFaText(person.full_name).trim().split(/\s+/u)[0]?.toLocaleLowerCase('fa-IR');if(first&&tokens.has(first))ids.add(person.id)}
  return[...ids];
 },[profile?.organization_id]);

 const send=async()=>{
  const body=normalizeFaText(text);if(!body||!selectedId)return;broadcastTyping(false);
  const clientUuid=makeClientId();const now=new Date().toISOString();
  const optimistic:ChatMessage={id:'local-'+clientUuid,organization_id:profile?.organization_id??'',conversation_id:selectedId,sender_id:user?.id??'',client_uuid:clientUuid,message_type:'text',body,reply_to_message_id:reply?.id??null,forwarded_from_message_id:null,thread_root_message_id:null,delivery_status:'queued',edited_at:null,deleted_at:null,deleted_for_all_at:null,created_at:now,updated_at:now};
  setMessages(previous=>[...previous,optimistic]);setText('');setReply(null);nearBottomRef.current=true;scrollBottom(true);
  try{
   const result=await sendMessage(selectedId,clientUuid,body,optimistic.reply_to_message_id);
   if('queueId' in result){
    return;
   }
   const sentMessage=result;
   const mentionIds=await resolveMentionUserIds(body);if(mentionIds.length)await setMessageMentions(sentMessage.id,mentionIds);
   setMessages(previous=>mergeMessages(previous,[sentMessage],queueSyncRef.current.filter(item=>String(item.args.p_conversation_id)===selectedId)));
   void refresh();
  }catch(e){setError(err(e));setMessages(previous=>previous.map(message=>message.client_uuid===clientUuid?{...message,delivery_status:'failed'}:message))}
 };

 const runSearch=async()=>{if(!query.trim()){setResults([]);return}try{setResults(await searchChat(query,selectedId??undefined))}catch(e){setError(err(e))}};
 const jumpToSearchResult=(result:{id:string;conversation_id:string})=>{pendingScrollMessage.current=result.id;setResults([]);setSelectedId(result.conversation_id)};
 const retry=(clientUuid:string)=>{void retryChatMessage(clientUuid).catch(e=>setError(err(e)))};
 const react=async(m:ChatMessage,emoji:string)=>{try{await toggleChatReaction(m.id,emoji);if(selectedId)await loadConversation(selectedId,false);setMenu(null)}catch(e){setError(err(e))}};
 const remove=async(m:ChatMessage,all:boolean)=>{try{if(all)await deleteForAll(m.id);else await deleteForMe(m.id);setMenu(null);if(selectedId)await loadConversation(selectedId,false)}catch(e){setError(err(e))}};
 const editCurrent=async()=>{if(!editId||!selectedId)return;const body=normalizeFaText(text);if(!body)return;try{await editChatMessage(editId,body);setEditId(null);setText('');await loadConversation(selectedId,false)}catch(e){setError(err(e))}};
 const forwardCurrent=async(targetId:string)=>{if(!forwardId)return;try{await forwardChatMessage(forwardId,targetId);setForwardId(null);void refresh();setError('پیام ارسال شد.')}catch(e){setError(err(e))}};
 const publishShipmentUpdate=async()=>{const selected=conversations.find(c=>c.conversation_id===selectedId);if(!selectedId||!selected?.shipment_id)return;try{await shareShipmentUpdate(selectedId,selected.shipment_id,shipmentStatus,shipmentNote.trim()||undefined);setShipmentUpdateOpen(false);setShipmentNote('');await loadConversation(selectedId,false);void refresh()}catch(e){setError(err(e))}};

 const loadOlder=useCallback(async()=>{
  if(!selectedId||olderLoadingRef.current||!hasOlder)return;
  const first=[...messages].sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()||a.id.localeCompare(b.id))[0];if(!first||first.id.startsWith('local-'))return;
  const area=messageArea.current;if(!area)return;
  olderLoadingRef.current=true;setOlderLoading(true);const oldHeight=area.scrollHeight;
  try{
   const data=await listMessages(selectedId,{createdAt:first.created_at,id:first.id});const older=[...data].reverse();setHasOlder(data.length>=50);
   if(older.length){setMessages(previous=>mergeMessages([...older,...previous],[],queueSyncRef.current.filter(item=>String(item.args.p_conversation_id)===selectedId)));requestAnimationFrame(()=>{area.scrollTop+=area.scrollHeight-oldHeight})}
  }catch(e){setError(err(e))}finally{olderLoadingRef.current=false;setOlderLoading(false)}
 },[hasOlder,messages,selectedId]);

 const onScroll=()=>{const area=messageArea.current;if(!area)return;const distance=area.scrollHeight-area.scrollTop-area.clientHeight;nearBottomRef.current=distance<96;if(nearBottomRef.current)setNewMessageCount(0);if(area.scrollTop<180)void loadOlder()};

 const markVisibleRead=useCallback(()=>{
  if(!selectedId||!user?.id)return;const items=[...document.querySelectorAll<HTMLElement>('[data-chat-message="true"]')];
  let highest=-1;
  for(const item of items){const rect=item.getBoundingClientRect();if(rect.top<window.innerHeight&&rect.bottom>0){const index=Number(item.dataset.messageIndex);const message=messages[index];if(message&&message.sender_id!==user.id&&index>highest)highest=index}}
  if(highest<=readIndexRef.current)return;const message=messages[highest];if(!message||message.id.startsWith('local-'))return;readIndexRef.current=highest;
  if(readTimer.current!==null)window.clearTimeout(readTimer.current);readTimer.current=window.setTimeout(()=>{void markRead(selectedId,message.id).then(()=>refresh()).catch(()=>{})},250);
 },[messages,refresh,selectedId,user?.id]);

 useEffect(()=>{
  const area=messageArea.current;if(!area)return;
  const nodes=[...area.querySelectorAll<HTMLElement>('[data-chat-message="true"]')];if(!nodes.length)return;
  const observer=new IntersectionObserver(()=>markVisibleRead(),{root:area,threshold:[0.6]});nodes.forEach(node=>observer.observe(node));void markVisibleRead();
  return()=>observer.disconnect();
 },[markVisibleRead,messages]);

 useEffect(()=>{
  if(!selectedId||loading||!pendingScrollMessage.current)return;
  const id=pendingScrollMessage.current;
  const jump=()=>{
   const element=document.getElementById('msg-'+id);
   if(element){pendingScrollMessage.current=null;element.scrollIntoView({behavior:'smooth',block:'center'});return;}
   void getMessageById(id).then(message=>{
    if(!message||message.conversation_id!==selectedId)return;
    setMessages(previous=>mergeMessages(previous,[message],queueSyncRef.current.filter(item=>String(item.args.p_conversation_id)===selectedId)));
    requestAnimationFrame(()=>document.getElementById('msg-'+id)?.scrollIntoView({behavior:'smooth',block:'center'}));
    pendingScrollMessage.current=null;
   }).catch(()=>{pendingScrollMessage.current=null});
  };
  requestAnimationFrame(jump);
 },[getMessageById,loading,messages,selectedId]);

 useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenu(null);setForwardId(null);setPeopleOpen(false);setChannelOpen(false);setDirectoryOpen(false);setSettingsOpen(false)}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[]);

 const selected=conversations.find(c=>c.conversation_id===selectedId)??null;
 const voice=useVoiceCall({userId:user?.id,organizationId:profile?.organization_id,conversationId:selected?.conversation_id??null,peerUserId:selected?.type==='direct'?selected.display_user_id??null:null,peerName:selected?.display_name||selected?.title||'همکار',requestedCallId});
 useEffect(()=>{if(voice.error)setError(voice.error)},[voice.error]);

 const unread=useMemo(()=>conversations.reduce((n,c)=>n+Number(c.unread_count??0),0),[conversations]);
 const filteredPeople=useMemo(()=>{const q=normalizeFaText(personQuery).toLowerCase();return people.filter(person=>person.id!==user?.id&&(!q||normalizeFaText(person.full_name).toLowerCase().includes(q)||(person.phone??'').includes(q)))},[people,personQuery,user?.id]);
 const folderLabels:Record<ChatFolder,string>={all:'همه',coworkers:'همکاران',groups:'گروه‌ها',owners:'صاحب کالا',shipments:'محموله‌ها',unread:'خوانده‌نشده'};
 const statusView=(m:ChatMessage)=>{
  if(m.delivery_status==='queued')return<Clock size={13} aria-label="در صف ارسال"/>;
  if(m.delivery_status==='sending')return<Loader2 size={13} className="animate-spin" aria-label="در حال ارسال"/>;
  if(m.delivery_status==='sent')return<Check size={13} aria-label="ارسال شد"/>;
  if(m.delivery_status==='delivered')return<CheckCheck size={13} className="opacity-80" aria-label="تحویل شد"/>;
  if(m.delivery_status==='read')return<CheckCheck size={13} className="text-sky-400" aria-label="خوانده شد"/>;
  return<AlertCircle size={13} className="text-red-300" aria-label="ارسال ناموفق"/>;
 };

 const chatRootClass='chat-standalone w-full h-dvh min-h-[560px] flex flex-col gap-0 bg-[var(--surface)]';
 return<div dir="rtl" className={chatRootClass} data-chat-wallpaper="plain" data-chat-selected={selectedId?'true':'false'}>
  <div className="chat-safe-top" aria-hidden="true"/>
  <header className="chat-app-header shrink-0">
   <div className="chat-app-header-main">
    <button type="button" className="chat-app-brand" onClick={()=>{if(selectedId){setSelectedId(null);setMessages([]);setReply(null);setResults([])}}} aria-label={selectedId?'بازگشت به فهرست گفتگوها':'صفحه اصلی چت'}>
     {selectedId?<ArrowRight size={18}/>:<ChatBrandLogo size={34}/>}<span><b>چت سازمانی</b><small>{selectedId?'گفتگو':'مرکز ارتباطات داخلی Customs OS'}</small></span>
    </button>
    <div className="chat-app-header-status"><span className={"chat-app-status-dot "+(online?'is-online':'is-offline')}/><span>{realtimeState==='offline'?'آفلاین':realtimeState==='syncing'?'همگام‌سازی…':realtimeState==='connecting'?'در حال اتصال…':realtimeState==='degraded'?'اتصال ناپایدار':'آنلاین'}</span></div>
    {!selectedId&&<div className="hidden md:flex items-center gap-2 min-w-0 text-right"><div className="h-9 w-9 rounded-full bg-[var(--primary)] text-white grid place-items-center font-black">{(profile?.full_name||'ک').slice(0,1)}</div><div className="min-w-0"><b className="block text-xs truncate">{profile?.full_name||'کاربر'}</b><span className="block text-[10px] app-muted truncate">{profile?.role||''}</span></div></div>}
   </div>
  </header>

  <div className={selectedId?'hidden md:flex':'flex'} style={{height:selectedId?'0':'auto',minHeight:selectedId?'0':undefined}}>
   {!selectedId&&<ChatQuickNav
 people={people.filter(person=>person.id!==user?.id)}
 conversations={conversations}
 role={profile?.role}
 onNewMessage={()=>void openPeople('direct')}
 onSelectFolder={nextFolder=>setFolder(nextFolder)}
 onOpenDirectory={openDirectory}
 onOpenAi={()=>setError('پنل هوش مصنوعی در پایین صفحه باز است.')}
 onOpenSettings={()=>setSettingsOpen(true)}
/>}
  </div>

  {!selectedId&&<div className="flex-1 min-h-0 flex flex-col px-2 md:px-4 pb-2">
   <section className="flex-1 min-h-0 rounded-2xl border app-border bg-[var(--surface)] overflow-hidden flex flex-col">
    <header className="h-[60px] shrink-0 px-3 border-b app-border flex items-center gap-2">
     <div className="min-w-0 flex-1"><b className="block text-sm">گفتگوها</b><div className="text-[10px] app-muted truncate">{unread?String(unread)+' پیام خوانده‌نشده':'فهرست گفتگوهای سازمان'}</div></div>
     <button type="button" className="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" onClick={()=>void openPeople('direct')} aria-label="پیام جدید"><Plus size={18}/></button>
     {profile?.role!=='client'&&<button type="button" className="h-10 px-3 shrink-0 rounded-xl flex items-center justify-center gap-1 border app-border text-xs font-bold" onClick={()=>{setChannelType('group');setChannelOpen(true)}} aria-label="گروه جدید"><Users size={15}/>گروه جدید</button>}
    </header>
    <div className="px-3 py-2 border-b app-border"><div className="h-12 rounded-2xl bg-black/5 dark:bg-white/10 flex items-center gap-2 px-3"><Search size={16} className="app-muted"/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void runSearch()}} placeholder="جست‌وجو در گفتگوها" className="bg-transparent outline-none flex-1 text-sm min-w-0"/></div></div>
    <div className="chat-folder-strip px-3 py-2 border-b app-border overflow-x-auto flex gap-2">{Object.entries(folderLabels).map(([key,label])=><button type="button" key={key} onClick={()=>setFolder(key as ChatFolder)} className={"shrink-0 min-h-10 px-3 rounded-xl text-xs font-bold border app-border "+(folder===key?'bg-[var(--primary)] text-white':'bg-[var(--surface-2)]')} aria-pressed={folder===key}>{label}{key==='unread'&&unread>0?<span className="mr-1">({unread})</span>:null}</button>)}</div>
    {results.length>0&&<div className="border-b app-border max-h-48 overflow-y-auto">{results.map(r=><button type="button" key={r.id} onClick={()=>jumpToSearchResult(r)} className="w-full text-right px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5"><b className="text-xs block truncate">{r.title}</b><span className="text-[10px] app-muted block truncate mt-1">{r.snippet}</span></button>)}</div>}
    <ChatHierarchyPanel selectedId={selectedId} onSelect={id=>{setSelectedId(id);setMessages([]);setResults([]);setMenu(null)}} conversations={conversations} folder={folder}/>
   </section>
  </div>}

  {selected&&<section className="flex-1 min-w-0 rounded-none md:rounded-2xl md:border app-border bg-[var(--surface)] overflow-hidden flex flex-col">
   <header className="h-[72px] shrink-0 border-b app-border px-3 md:px-4 flex items-center gap-2">
    <button type="button" className="h-12 w-12 shrink-0 rounded-full flex items-center justify-center md:hidden" onClick={()=>{setSelectedId(null);setMessages([]);setReply(null)}} aria-label="بازگشت"><ArrowRight size={19}/></button>
    <div className="h-12 w-12 rounded-full bg-[var(--primary)] text-white flex items-center justify-center font-bold">{selected.type==='direct'?(title(selected).slice(0,1)||'?'):selected.type==='company_channel'?<Hash size={19}/>:<Users size={19}/>}</div>
    <div className="flex-1 min-w-0"><b className="block truncate text-[16px]">{title(selected)}</b><div className="text-[12px] app-muted truncate">{selected.type==='direct'?(typingUsers.length?'در حال نوشتن…':selected.display_phone||'گفتگوی مستقیم'):(typingUsers.length?'در حال نوشتن…':realtimeState==='ready'?'آنلاین':'در حال همگام‌سازی')}</div></div>
    {selected.shipment_id&&<button type="button" className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" onClick={()=>setShipmentUpdateOpen(true)} aria-label="وضعیت محموله"><PackageCheck size={17}/></button>}
    {(selected.type==='group'||selected.type==='company_channel')&&<button type="button" className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" onClick={()=>void openPeople('member')} aria-label="افزودن عضو"><UserPlus size={16}/></button>}
    {selected.type==='direct'&&selected.display_user_id&&voice.canCall&&<button type="button" className="h-12 w-12 shrink-0 rounded-full flex items-center justify-center text-white bg-[var(--primary)] hover:opacity-90 shadow-sm" aria-label="تماس صوتی زنده" onClick={()=>void voice.startCall()}><Phone size={19}/></button>}
    <button type="button" className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" title={pushReady?'اعلان‌های پیام فعال است':'فعال‌سازی اعلان پیام'} onClick={()=>void enablePush()} disabled={pushBusy} aria-label={pushReady?'اعلان فعال است':'فعال‌سازی اعلان پیام'}>{pushReady?<Bell size={17}/>:<BellOff size={17}/>}</button>
    {realtimeReady&&online?<Wifi size={16}/>:<WifiOff size={16}/>}
   </header>

   <div ref={messageArea} onScroll={onScroll} className="chat-message-area relative flex-1 min-h-0 overflow-y-auto px-3 py-5 md:px-5 md:py-6 overscroll-contain bg-[radial-gradient(circle_at_20%_20%,rgba(0,0,0,.03),transparent_20%),radial-gradient(circle_at_80%_80%,rgba(0,0,0,.025),transparent_18%)] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,.03),transparent_20%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,.02),transparent_18%)]">
    {olderLoading&&<div className="absolute top-2 left-0 right-0 z-10 flex justify-center"><span className="px-3 py-1 rounded-full bg-[var(--surface)] border app-border text-[10px] app-muted shadow-sm"><Loader2 size={11} className="inline ml-1 animate-spin"/>در حال دریافت پیام‌های قدیمی…</span></div>}
    {!hasOlder&&messages.length>0&&<div className="text-center text-[10px] app-muted pb-2">ابتدای گفتگو</div>}
    {messages.map((m,index)=>{
      const own=m.sender_id===user?.id;const local=m.id.startsWith('local-');const deleted=Boolean(m.deleted_for_all_at);const previous=messages[index-1];const showDay=!previous||dayKey(previous.created_at)!==dayKey(m.created_at);const quoted=m.reply_to_message_id?messages.find(message=>message.id===m.reply_to_message_id):null;
      return <React.Fragment key={m.id}>
       {showDay&&<div className="flex justify-center my-3"><span className="px-3 py-1 rounded-full bg-black/5 dark:bg-white/10 text-[10px] app-muted shadow-sm">{dayLabel(m.created_at)}</span></div>}
       <div id={"msg-"+m.id} data-chat-message="true" data-message-index={index} className={"flex mb-1.5 "+(own?'justify-start':'justify-end')}>
        <div className="max-w-[88%] md:max-w-[72%]">
         <div className={"relative rounded-2xl px-4 py-2.5 shadow-sm "+(own?'bg-[var(--primary)] text-white rounded-br-md':'bg-black/5 dark:bg-white/10 rounded-bl-md')}>
          {!own&&selected.type!=='direct'&&m.sender_name&&document.querySelector<HTMLElement>('.chat-standalone')?.dataset.chatShowSenderNames!=='false'&&<div className="text-[10px] font-bold mb-1 app-muted">{m.sender_name}</div>}
          {quoted&&<button type="button" className="w-full text-right mb-2 px-2 py-1 rounded-lg border border-current/20 text-[10px] opacity-80" onClick={()=>document.getElementById('msg-'+quoted.id)?.scrollIntoView({behavior:'smooth',block:'center'})}>{quoted.body||'پیام پیوست‌دار'}</button>}
          {deleted?<div className="text-sm italic opacity-80">این پیام حذف شده است.</div>:m.body&&<div className="chat-message-text text-[17px] leading-8 whitespace-pre-wrap break-words">{m.body}</div>}
          {!deleted&&(m.attachments??[]).map(a=>a.security_status==='clean'&&a.url?(a.mime_type.startsWith('audio/')?<audio key={a.id} controls src={a.url} onPlay={()=>{if(!own)void markPlayed(m.id).catch(()=>{})}} className="mt-2 w-full max-w-[280px]" aria-label="پیام صوتی"/>:<a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 rounded-xl bg-black/10 dark:bg-white/10 px-3 py-2 text-xs underline"><Paperclip size={14}/><span className="truncate">{a.original_name}</span></a>):<div key={a.id} className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs">{a.security_status==='blocked'?'فایل مسدود شد.':'فایل در حال بررسی امنیتی است…'}</div>)}
          {(m.reactions??[]).length>0&&<div className="flex flex-wrap gap-1 mt-2">{Array.from(new Set((m.reactions??[]).map(r=>r.emoji))).map(emoji=><button type="button" key={emoji} onClick={()=>void react(m,emoji)} className="rounded-full px-2 py-1 text-[11px] bg-black/10 dark:bg-white/10">{emoji} {((m.reactions??[]).filter(r=>r.emoji===emoji)).length}</button>)}</div>}
          <div className={"flex items-center justify-end gap-1 mt-1 text-[11px] "+(own?'text-white/75':'app-muted')}>
           {m.edited_at&&<span>ویرایش‌شده</span>}<span>{chatTime(m.created_at)}</span>
           {own&&<span className="inline-flex items-center">{statusView(m)}</span>}
           {own&&m.delivery_status==='failed'&&<button type="button" className="mr-1 underline font-bold text-red-200" onClick={()=>retry(m.client_uuid)} aria-label="تلاش مجدد ارسال">تلاش مجدد</button>}
           {!deleted&&!local&&<button type="button" onClick={()=>setMenu(menu===m.id?null:m.id)} aria-label="گزینه‌های پیام" className="min-h-8 min-w-8 grid place-items-center"><MoreVertical size={14}/></button>}
          </div>
          {menu===m.id&&!local&&<div className="absolute z-20 left-1 bottom-7 rounded-2xl border app-border bg-[var(--surface)] text-[var(--text)] shadow-xl p-1 min-w-48">
           <div className="flex gap-1 p-1 border-b app-border">{['❤️','👍','😂','😮','😢','🔥'].map(emoji=><button type="button" key={emoji} onClick={()=>void react(m,emoji)} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10" aria-label={emoji}>{emoji}</button>)}</div>
           <button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>{setReply(m);setMenu(null)}}>پاسخ</button>
           {own&&<button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>{setEditId(m.id);setText(m.body??'');setReply(null);setMenu(null)}}>ویرایش</button>}
           <button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>void toggleChatStar(m.id).then(()=>selectedId?loadConversation(selectedId,false):undefined).catch(e=>setError(err(e)))}><Star size={13} className="inline ml-1"/>ستاره</button>
           <button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>void toggleChatPin(m.id).then(()=>selectedId?loadConversation(selectedId,false):undefined).catch(e=>setError(err(e)))}><Pin size={13} className="inline ml-1"/>سنجاق</button>
           <button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>{setForwardId(m.id);setMenu(null)}}>فوروارد</button>
           <button type="button" className="w-full text-right px-3 py-2 text-xs" onClick={()=>void remove(m,false)}><Trash2 size={13} className="inline ml-1"/>حذف برای من</button>
           {own&&<button type="button" className="w-full text-right px-3 py-2 text-xs text-red-600" onClick={()=>void remove(m,true)}>حذف برای همه</button>}
          </div>}
         </div>
        </div>
       </div>
      </React.Fragment>;
    })}
    {newMessageCount>0&&<button type="button" onClick={()=>{nearBottomRef.current=true;setNewMessageCount(0);scrollBottom(true)}} className="sticky bottom-2 mx-auto flex items-center gap-1 px-4 py-2 rounded-full bg-[var(--primary)] text-white text-xs font-bold shadow-lg z-20">{newMessageCount} پیام جدید <ChevronDown size={14}/></button>}
    <div ref={bottom}/>
   </div>

   {(reply||editId)&&<div className="mx-2 md:mx-3 mb-1 rounded-xl border app-border bg-black/5 dark:bg-white/5 p-2 flex gap-2 items-center"><div className="w-1 self-stretch rounded-full bg-[var(--primary)]"/><div className="flex-1 min-w-0 text-xs truncate">{editId?'در حال ویرایش پیام':'پاسخ به: '+(reply?.body||'پیام پیوست‌دار')}</div><button type="button" className="icon-btn" onClick={()=>{setReply(null);setEditId(null);setText('')}} aria-label="لغو"><X size={15}/></button></div>}

   <div className="shrink-0 border-t app-border p-3 md:p-3 bg-[var(--surface)]" style={{paddingBottom:'max(12px,env(safe-area-inset-bottom))'}}>
    <input ref={fileInput} type="file" className="hidden" accept="image/*,application/pdf,text/plain,.doc,.docx,.xls,.xlsx" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value='';void chooseAttachment(file)}}/>
    <div className="flex items-end gap-1.5 md:gap-2">
     <button type="button" className="h-12 w-12 shrink-0 rounded-full border app-border flex items-center justify-center disabled:opacity-40" disabled={attachmentBusy} onClick={()=>fileInput.current?.click()} aria-label="پیوست"><Paperclip size={18}/></button>
     <button type="button" className={"h-11 w-11 shrink-0 rounded-full border app-border flex items-center justify-center "+(recording?'bg-red-600 text-white':'')} disabled={attachmentBusy} onClick={()=>void toggleVoice()} aria-label={recording?'توقف ضبط':'ضبط صدا'}>{recording?<MicOff size={18}/>:<Mic size={18}/>}</button>
     <textarea value={text} onChange={e=>{setText(e.target.value);broadcastTyping(Boolean(e.target.value.trim()))}} onBlur={()=>broadcastTyping(false)} onKeyDown={e=>{const sendOnEnter=document.querySelector<HTMLElement>('.chat-standalone')?.dataset.chatSendOnEnter!=='false';if(e.key==='Enter'&&!e.shiftKey&&sendOnEnter){e.preventDefault();void send()}}} placeholder={online?'پیام بنویسید…':'آفلاین؛ پیام در صف ارسال می‌ماند…'} rows={1} className="flex-1 resize-none min-h-12 max-h-32 rounded-[24px] border app-border bg-transparent px-4 py-3 outline-none text-[15px]"/>
     <button type="button" className="h-12 w-12 shrink-0 rounded-full bg-[var(--primary)] text-white flex items-center justify-center disabled:opacity-40" disabled={!text.trim()||attachmentBusy} onClick={()=>void send()} aria-label="ارسال"><Send size={18}/></button>
    </div>
    {mediaState!=='idle'&&<div className="mt-2 px-1 text-[10px] app-muted flex items-center gap-2">{mediaState==='recording'?'در حال ضبط صدا…':mediaState==='preparing'?'در حال آماده‌سازی…':mediaState==='uploading'?'در حال بارگذاری فایل…':'فایل ارسال شد.'}{mediaState==='uploading'&&<span className="h-1.5 flex-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden"><span className="block h-full w-full bg-[var(--primary)] animate-pulse"/></span>}</div>}
    {ocrBusy&&<div className="text-[10px] app-muted mt-1 px-1">در حال OCR تصویر…</div>}
   </div>
  </section>}

  <ChatFeatureBoundary><ChatAIOperatorPanel pageContext="chat — آمار محموله‌ها، پرونده‌ها و عملیات سازمانی"/></ChatFeatureBoundary>
  <ChatFeatureBoundary><ChatSettingsPanel open={settingsOpen} onClose={()=>setSettingsOpen(false)}/></ChatFeatureBoundary>
  <ChatFeatureBoundary><VoiceCallPanel controller={voice}/></ChatFeatureBoundary>

  <ChatDirectoryPanel
 open={directoryOpen}
 mode={directoryMode}
 organizationId={profile?.organization_id}
 currentUserId={user?.id}
 people={people.filter(person=>person.id!==user?.id)}
 onClose={()=>setDirectoryOpen(false)}
 onSelectConversation={id=>{setDirectoryOpen(false);setSelectedId(id)}}
 onNewMessage={()=>{setDirectoryOpen(false);void openPeople('direct')}}
 onStartDirect={id=>void newChat(id)}
/>

  {peopleOpen&&<div className="fixed inset-0 z-[600] bg-black/45 flex items-end md:items-center justify-center" onClick={()=>setPeopleOpen(false)}>
   <div dir="rtl" className="w-full md:max-w-lg max-h-[86vh] overflow-hidden rounded-t-3xl md:rounded-2xl bg-[var(--surface)] border app-border shadow-2xl" onClick={e=>e.stopPropagation()}>
    <div className="p-4 border-b app-border flex items-center gap-2"><div className="flex-1"><b>{peopleMode==='direct'?'پیام جدید':'افزودن عضو'}</b><div className="text-xs app-muted mt-1">{peopleMode==='direct'?'یک همکار را انتخاب کنید.':'عضو جدید را انتخاب کنید.'}</div></div><button type="button" className="icon-btn" onClick={()=>setPeopleOpen(false)} aria-label="بستن"><X size={17}/></button></div>
    <div className="p-3 border-b app-border"><div className="h-11 rounded-xl bg-black/5 dark:bg-white/10 flex items-center gap-2 px-3"><Search size={16}/><input autoFocus value={personQuery} onChange={e=>setPersonQuery(e.target.value)} placeholder="جست‌وجوی مخاطب" className="bg-transparent outline-none flex-1 text-sm"/></div></div>
    <div className="max-h-[58vh] overflow-y-auto">{filteredPeople.map(p=><button type="button" key={p.id} onClick={()=>void(peopleMode==='direct'?newChat(p.id):addMember(p.id))} className="w-full p-3 flex items-center gap-3 border-b app-border text-right min-h-[70px] hover:bg-black/5 dark:hover:bg-white/5"><div className="h-11 w-11 shrink-0 rounded-full bg-[var(--primary)] text-white flex items-center justify-center font-bold">{p.full_name.trim().slice(0,1)||<UserRound size={17}/>}</div><div className="min-w-0 flex-1"><b className="block truncate">{p.full_name}</b><div className="text-xs app-muted truncate mt-1">{p.phone||'شماره ثبت نشده'} · {p.role}</div></div></button>)}{!filteredPeople.length&&<div className="p-8 text-center app-muted text-sm">مخاطبی پیدا نشد.</div>}</div>
   </div>
  </div>}

  {channelOpen&&<div className="fixed inset-0 z-[610] bg-black/45 flex items-end md:items-center justify-center" onClick={()=>setChannelOpen(false)}>
   <div dir="rtl" className="w-full md:max-w-md rounded-t-3xl md:rounded-2xl bg-[var(--surface)] border app-border shadow-2xl p-4" onClick={e=>e.stopPropagation()}>
    <div className="flex items-center justify-between"><div><b>ایجاد گروه / کانال</b><div className="text-xs app-muted mt-1">گفت‌وگوی گروهی سازمانی</div></div><button type="button" onClick={()=>setChannelOpen(false)} aria-label="بستن"><X size={16}/></button></div>
    <input value={channelTitle} onChange={e=>setChannelTitle(e.target.value)} placeholder="نام گروه یا کانال" className="w-full min-h-11 rounded-xl border app-border bg-transparent px-3 mt-4 outline-none"/>
    <div className="grid grid-cols-2 gap-2 mt-3"><button type="button" onClick={()=>setChannelType('company_channel')} className={"min-h-11 rounded-xl border app-border text-xs "+(channelType==='company_channel'?'bg-[var(--primary)] text-white':'')}>کانال داخلی</button><button type="button" onClick={()=>setChannelType('group')} className={"min-h-11 rounded-xl border app-border text-xs "+(channelType==='group'?'bg-[var(--primary)] text-white':'')}>گروه</button><button type="button" onClick={()=>setChannelType('shared_company')} disabled={!sharedConnections.length} className={"min-h-11 rounded-xl border app-border text-xs "+(channelType==='shared_company'?'bg-[var(--primary)] text-white':'')}>شرکت مشترک</button></div>
    {channelType==='shared_company'&&<select value={selectedConnection} onChange={e=>setSelectedConnection(e.target.value)} className="w-full min-h-11 rounded-xl border app-border bg-transparent px-3 mt-3"><option value="">انتخاب سازمان متصل</option>{sharedConnections.map(x=><option key={x.id} value={x.id}>{x.target_name}</option>)}</select>}
    <button type="button" disabled={!channelTitle.trim()} onClick={()=>void createChannel()} className="w-full min-h-11 rounded-xl bg-[var(--primary)] text-white font-bold mt-4 disabled:opacity-40">ایجاد</button>
   </div>
  </div>}

  {forwardId&&<div className="fixed inset-0 z-[620] bg-black/45 flex items-end md:items-center justify-center" onClick={()=>setForwardId(null)}>
   <div dir="rtl" className="w-full md:max-w-lg max-h-[82vh] overflow-hidden rounded-t-3xl md:rounded-2xl bg-[var(--surface)] border app-border shadow-2xl" onClick={e=>e.stopPropagation()}>
    <div className="p-4 border-b app-border flex items-center justify-between"><b>فوروارد پیام</b><button type="button" onClick={()=>setForwardId(null)} aria-label="بستن"><X size={16}/></button></div>
    <div className="max-h-[60vh] overflow-y-auto p-2">{conversations.filter(c=>c.conversation_id!==selectedId).map(c=><button type="button" key={c.conversation_id} onClick={()=>void forwardCurrent(c.conversation_id)} className="w-full min-h-[62px] rounded-xl px-3 py-2 flex items-center gap-3 text-right hover:bg-black/5 dark:hover:bg-white/5"><div className="h-10 w-10 rounded-full bg-[var(--primary)] text-white flex items-center justify-center">{c.type==='company_channel'?<Hash size={16}/>:<Users size={16}/>}</div><div className="min-w-0 flex-1"><b className="block truncate text-sm">{title(c)}</b><span className="block truncate text-xs app-muted mt-1">{c.last_message_body||'گفتگو'}</span></div></button>)}</div>
   </div>
  </div>}

  {shipmentUpdateOpen&&selected?.shipment_id&&<div className="fixed inset-0 z-[630] bg-black/45 flex items-end md:items-center justify-center" onClick={()=>setShipmentUpdateOpen(false)}>
   <div dir="rtl" className="w-full md:max-w-md rounded-t-3xl md:rounded-2xl bg-[var(--surface)] border app-border shadow-2xl p-4" onClick={e=>e.stopPropagation()}>
    <div className="flex items-center justify-between"><div><b>به‌روزرسانی محموله</b><div className="text-xs app-muted mt-1">{selected.shipment_bl_number||selected.shipment_display_name||'محموله'}</div></div><button type="button" onClick={()=>setShipmentUpdateOpen(false)} aria-label="بستن"><X size={16}/></button></div>
    <select value={shipmentStatus} onChange={e=>setShipmentStatus(e.target.value)} className="w-full h-11 rounded-xl border app-border bg-transparent px-3 mt-4">{['در انتظار','در حال بررسی','در مسیر','رسیده به بندر','در گمرک','ترخیص شده','تحویل شده','تاخیر'].map(status=><option key={status} value={status}>{status}</option>)}</select>
    <textarea value={shipmentNote} onChange={e=>setShipmentNote(e.target.value)} placeholder="توضیح وضعیت" rows={4} className="w-full mt-3 rounded-xl border app-border bg-transparent p-3 outline-none text-sm resize-none"/>
    <button type="button" onClick={()=>void publishShipmentUpdate()} className="w-full h-11 rounded-xl bg-[var(--primary)] text-white font-bold mt-3">ارسال وضعیت در کانال محموله</button>
   </div>
  </div>}

  {error&&<div className="fixed bottom-4 left-3 right-3 md:left-4 md:right-auto z-[850] max-w-md rounded-2xl border app-border bg-[var(--surface)] p-3 shadow-xl text-sm">{error}<button type="button" className="block text-xs mt-2 app-muted min-h-8" onClick={()=>setError(null)}>بستن</button></div>}
 </div>;
};

type PresenceUser={user_id:string;typing?:boolean};
