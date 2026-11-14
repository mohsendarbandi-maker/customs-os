import React,{useMemo,useRef,useState}from'react';
import{Archive,BellOff,ChevronDown,ChevronLeft,MessageCircle,Package,Users}from'lucide-react';
import{normalizeFaText}from'../../lib/jalali';
import{buildChatInboxRows,type ChatFolder}from'./conversationModel';
import type{ChatConversation}from'./types';

type Props={
 selectedId:string|null;
 onSelect:(id:string)=>void;
 conversations:ChatConversation[];
 folder?:ChatFolder;
 loading?:boolean;
};

const conversationTitle=(conversation:ChatConversation)=>normalizeFaText(conversation.display_name||conversation.title||'گفتگو');
const conversationKind=(conversation:ChatConversation)=>{
 if(conversation.type==='company_channel')return'کانال سازمانی';
 if(conversation.type==='shared_company')return'گروه مشترک';
 if(conversation.type==='group')return'گروه';
 return'گفتگوی مستقیم';
};
const unreadCount=(conversation:ChatConversation)=>Math.max(0,Number(conversation.unread_count)||0);
const vibrate=()=>{if(typeof navigator!=='undefined'&&typeof navigator.vibrate==='function')navigator.vibrate(10)};
const activityLabel=(conversation:ChatConversation)=>{
 const value=conversation.last_message_created_at||conversation.updated_at;
 if(!value)return'';
 const date=new Date(value);
 if(Number.isNaN(date.getTime()))return'';
 const options={timeZone:'Asia/Tehran',calendar:'persian'} as const;
 const sameDay=new Intl.DateTimeFormat('fa-IR',{...options,year:'numeric',month:'2-digit',day:'2-digit'}).format(date)===
  new Intl.DateTimeFormat('fa-IR',{...options,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return sameDay
  ?new Intl.DateTimeFormat('fa-IR',{...options,hour:'2-digit',minute:'2-digit'}).format(date)
  :new Intl.DateTimeFormat('fa-IR',{...options,day:'numeric',month:'short'}).format(date);
};
const avatarTone=(name:string)=>Array.from(name).reduce((total,character)=>total+(character.codePointAt(0)||0),0)%5;
const emitRowAction=(conversationId:string,action:'archive'|'mute',muted?:boolean)=>{
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('customs-os:chat-row-action',{detail:{conversationId,action,muted}}));
 vibrate();
};

export const ChatHierarchyPanel:React.FC<Props>=({selectedId,onSelect,conversations,folder='all',loading=false})=>{
 const[open,setOpen]=useState<Record<string,boolean>>({});
 const[swipedId,setSwipedId]=useState<string|null>(null);
 const[archivedIds,setArchivedIds]=useState<Set<string>>(()=>new Set());
 const[mutedIds,setMutedIds]=useState<Set<string>>(()=>new Set());
 const touchStart=useRef<{id:string;x:number;y:number}|null>(null);
 const suppressClick=useRef(false);
 const rows=useMemo(()=>buildChatInboxRows(conversations,folder),[conversations,folder]);
 const visibleRows=useMemo(()=>rows.filter(row=>row.kind!=='conversation'||!archivedIds.has(row.conversation.conversation_id)),[rows,archivedIds]);

 const emptyLabel=folder==='groups'?'گروهی پیدا نشد.':
  folder==='coworkers'?'گفتگوی مستقیمی پیدا نشد.':
  folder==='owners'?'گروه صاحب کالایی وجود ندارد.':
  folder==='shipments'?'گروه محموله‌ای وجود ندارد.':
  folder==='unread'?'پیام خوانده‌نشده‌ای نیست.':
  'هنوز گفتگویی وجود ندارد.';

 const toggleOwner=(conversationId:string,defaultExpanded:boolean)=>{
  setOpen(previous=>({...previous,[conversationId]:!(previous[conversationId]??defaultExpanded)}));
 };
 const handleTouchStart=(event:React.TouchEvent<HTMLDivElement>,id:string)=>{
  if(event.touches.length!==1){touchStart.current=null;return}
  const touch=event.touches[0];
  touchStart.current={id,x:touch.clientX,y:touch.clientY};
 };
 const handleTouchEnd=(event:React.TouchEvent<HTMLDivElement>)=>{
  const start=touchStart.current;touchStart.current=null;
  if(!start||event.changedTouches.length!==1)return;
  const touch=event.changedTouches[0];
  const deltaX=touch.clientX-start.x;const deltaY=touch.clientY-start.y;
  if(Math.abs(deltaX)<48||Math.abs(deltaX)<Math.abs(deltaY)*1.25)return;
  suppressClick.current=true;
  setSwipedId(deltaX<0?start.id:null);
  vibrate();
 };
 const selectConversation=(id:string)=>{
  if(suppressClick.current){suppressClick.current=false;return}
  setSwipedId(null);onSelect(id);
 };
 const runRowAction=(id:string,action:'archive'|'mute')=>{
  if(action==='archive')setArchivedIds(previous=>new Set(previous).add(id));
  else setMutedIds(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next});
  emitRowAction(id,action,action==='mute'?!mutedIds.has(id):undefined);
  setSwipedId(null);
 };

 return <div className="chat-hierarchy-panel flex-1 min-h-0 overflow-y-auto overscroll-contain" onClick={event=>{
  if(swipedId&&!(event.target instanceof Element&&event.target.closest('.chat-row-swipe-actions')))setSwipedId(null);
 }}>
  {loading&&<div className="chat-conversation-skeleton-list" role="status" aria-label="در حال بارگذاری گفتگوها">
   {Array.from({length:5},(_,index)=><div className="chat-conversation-skeleton" key={index}>
    <span className="chat-skeleton-avatar"/>
    <span className="chat-skeleton-copy"><i/><i/><i/></span>
    <span className="chat-skeleton-meta"><i/><i/></span>
   </div>)}
  </div>}
  {!loading&&visibleRows.length>0&&<div className="chat-conversation-list">
   {visibleRows.map(row=>{
    if(row.kind==='conversation'){
     const conversation=row.conversation;
     const selected=selectedId===conversation.conversation_id;
     const name=conversationTitle(conversation);
     const initial=Array.from(name)[0]||'ک';
     const tone=avatarTone(name);
     const unread=row.unreadCount;
     const muted=mutedIds.has(conversation.conversation_id);
     return <div
      key={conversation.conversation_id}
      className={'chat-conversation-swipe '+(swipedId===conversation.conversation_id?'is-swipe-open':'')}
      onTouchStart={event=>handleTouchStart(event,conversation.conversation_id)}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={()=>{touchStart.current=null}}
      data-conversation-id={conversation.conversation_id}
     >
      <div className="chat-row-swipe-actions" aria-hidden={swipedId!==conversation.conversation_id}>
       <button type="button" className="chat-row-action is-archive" tabIndex={swipedId===conversation.conversation_id?0:-1} onClick={()=>runRowAction(conversation.conversation_id,'archive')} aria-label="بایگانی گفتگو">
        <Archive size={16}/><span>بایگانی</span>
       </button>
       <button type="button" className="chat-row-action is-mute" tabIndex={swipedId===conversation.conversation_id?0:-1} onClick={()=>runRowAction(conversation.conversation_id,'mute')} aria-label={muted?'فعال‌کردن صدای گفتگو':'بی‌صدا کردن گفتگو'}>
        <BellOff size={16}/><span>{muted?'فعال‌کردن صدا':'بی‌صدا'}</span>
       </button>
      </div>
      <button
       type="button"
       onClick={()=>selectConversation(conversation.conversation_id)}
       className={'chat-conversation-row '+(selected?'is-selected':'')}
       aria-pressed={selected}
       aria-label={name+(unread?'، '+unread+' پیام خوانده‌نشده':'')}
      >
       <span className="chat-conversation-avatar" data-avatar-tone={tone} aria-hidden="true">{initial}</span>
       <span className="chat-conversation-copy">
        <span className="chat-conversation-titleline">
         <b className="chat-conversation-title">{name}</b>
         {folder==='groups'&&<small className="chat-conversation-kind">{conversationKind(conversation)}</small>}
        </span>
        <span className="chat-conversation-meta">
         {muted&&<BellOff size={12} aria-label="گفتگو بی‌صدا است"/>}
         <time dateTime={conversation.last_message_created_at||conversation.updated_at}>{activityLabel(conversation)}</time>
         {unread>0&&<span className="chat-conversation-unread" aria-label={unread+' پیام خوانده‌نشده'}>{unread>99?'99+':unread}</span>}
        </span>
        <span className="chat-conversation-preview">{conversation.last_message_body||'بدون پیام'}</span>
       </span>
      </button>
     </div>;
    }

    const ownerRow=row;
    const owner=ownerRow.owner;
    const children=ownerRow.children;
    const defaultExpanded=folder==='shipments'||(folder==='unread'&&ownerRow.hasUnreadChildren);
    const expanded=open[owner.conversation_id]??defaultExpanded;
    const selectedOwner=selectedId===owner.conversation_id;
    const nestedUnread=ownerRow.unreadChildren;
    return <article key={owner.conversation_id} className={'chat-owner-card '+(selectedOwner?'is-selected':'')+(ownerRow.hasUnreadChildren?' has-unread':'')} data-unread={ownerRow.hasUnreadChildren?'true':'false'}>
     <div className="chat-owner-row">
      <button type="button" className="chat-owner-toggle" onClick={()=>toggleOwner(owner.conversation_id,defaultExpanded)} aria-label={expanded?'بستن محموله‌های صاحب کالا':'نمایش محموله‌های صاحب کالا'} aria-expanded={expanded}>
       {expanded?<ChevronDown size={16}/>:<ChevronLeft size={16}/>}
      </button>
      <button type="button" className="chat-owner-select" onClick={()=>toggleOwner(owner.conversation_id,defaultExpanded)} aria-expanded={expanded} aria-label={(expanded?'بستن':'نمایش')+' محموله‌های '+normalizeFaText(owner.title||'صاحب کالا')}>
       <span className="chat-owner-avatar"><Users size={18}/></span>
       <span className="chat-owner-copy">
        <span className="chat-owner-name">{normalizeFaText(owner.title||'صاحب کالا')}</span>
        <span className="chat-owner-meta">
         <span className="chat-owner-count">{children.length} محموله</span>
         {nestedUnread>0
          ?<span className="chat-owner-new-activity">{nestedUnread} محموله با پیام جدید</span>
          :<span>گروه صاحب کالا</span>}
         <time dateTime={owner.last_message_created_at||owner.updated_at}>{activityLabel(owner)}</time>
        </span>
       </span>
      </button>
      {ownerRow.unreadCount>0&&<span className="chat-owner-unread" aria-label={ownerRow.unreadCount+' پیام خوانده‌نشده در این صاحب کالا'}>{ownerRow.unreadCount}</span>}
      <button type="button" className="chat-owner-open-chat" onClick={()=>onSelect(owner.conversation_id)} aria-label={'بازکردن گفتگوی '+normalizeFaText(owner.title||'صاحب کالا')} title="گفتگوی صاحب کالا">
       <MessageCircle size={16}/>
      </button>
     </div>
     {expanded&&children.length>0&&<div className="chat-shipment-list">
      {children.map(shipment=>{
       const selected=selectedId===shipment.conversation_id;
       const unread=unreadCount(shipment);
       return <button type="button" key={shipment.conversation_id} onClick={()=>onSelect(shipment.conversation_id)} className={'chat-shipment-row '+(selected?'is-selected':'')+(unread?' has-unread':'')} aria-pressed={selected}>
        <span className="chat-shipment-icon"><Package size={16}/></span>
        <span className="chat-shipment-copy">
         <span className="chat-shipment-name">{normalizeFaText(shipment.shipment_display_name||shipment.title||'محموله')}</span>
         <span className="chat-shipment-bl">{unread&&shipment.last_message_body?shipment.last_message_body:(shipment.shipment_bl_number||'بدون شماره بارنامه')}</span>
        </span>
        <span className="chat-shipment-meta"><time dateTime={shipment.last_message_created_at||shipment.updated_at}>{activityLabel(shipment)}</time>{unread>0&&<span className="chat-shipment-unread" aria-label={unread+' پیام خوانده‌نشده'}>{unread}</span>}</span>
       </button>;
      })}
     </div>}
    </article>;
   })}
  </div>}
  {!loading&&visibleRows.length===0&&<div className="chat-conversation-empty"><span className="chat-conversation-empty-icon"><Users size={23}/></span><b>{emptyLabel}</b><span>{folder==='unread'?'همهٔ گفتگوها به‌روز هستند.':'برای شروع، یک گفتگو یا گروه تازه بسازید.'}</span></div>}
 </div>;
};
