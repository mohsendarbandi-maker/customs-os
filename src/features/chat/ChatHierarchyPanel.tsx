import React,{useMemo,useState}from'react';
import{ChevronDown,ChevronLeft,MessageCircle,Package,Users}from'lucide-react';
import{normalizeFaText}from'../../lib/jalali';
import{buildChatInboxRows,type ChatFolder}from'./conversationModel';
import type{ChatConversation}from'./types';

type Props={
 selectedId:string|null;
 onSelect:(id:string)=>void;
 conversations:ChatConversation[];
 folder?:ChatFolder;
};

const conversationTitle=(conversation:ChatConversation)=>normalizeFaText(conversation.display_name||conversation.title||'گفتگو');
const conversationKind=(conversation:ChatConversation)=>{
 if(conversation.type==='company_channel')return'کانال سازمانی';
 if(conversation.type==='shared_company')return'گروه مشترک';
 if(conversation.type==='group')return'گروه';
 return'گفتگوی مستقیم';
};
const unreadCount=(conversation:ChatConversation)=>Math.max(0,Number(conversation.unread_count)||0);

export const ChatHierarchyPanel:React.FC<Props>=({selectedId,onSelect,conversations,folder='all'})=>{
 const[open,setOpen]=useState<Record<string,boolean>>({});
 const rows=useMemo(()=>buildChatInboxRows(conversations,folder),[conversations,folder]);

 const emptyLabel=folder==='groups'?'گروهی پیدا نشد.':
  folder==='coworkers'?'گفتگوی مستقیمی پیدا نشد.':
  folder==='owners'?'گروه صاحب کالایی وجود ندارد.':
  folder==='shipments'?'گروه محموله‌ای وجود ندارد.':
  folder==='unread'?'پیام خوانده‌نشده‌ای نیست.':
  'هنوز گفتگویی وجود ندارد.';

 const toggleOwner=(conversationId:string,defaultExpanded:boolean)=>{
  setOpen(previous=>({...previous,[conversationId]:!(previous[conversationId]??defaultExpanded)}));
 };

 return <div className="chat-hierarchy-panel flex-1 min-h-0 overflow-y-auto overscroll-contain">
  {rows.length>0&&<div className="chat-conversation-list">
   {rows.map(row=>{
    if(row.kind==='conversation'){
     const conversation=row.conversation;
     const selected=selectedId===conversation.conversation_id;
     return <button
      type="button"
      key={conversation.conversation_id}
      onClick={()=>onSelect(conversation.conversation_id)}
      className={'chat-conversation-row '+(selected?'is-selected':'')}
      aria-pressed={selected}
     >
      <span className="chat-conversation-avatar">
       {conversation.type==='direct'?<span className="font-black text-sm">{(conversation.display_name||'ک').slice(0,1)}</span>:<Users size={19}/>}
      </span>
      <span className="chat-conversation-copy">
       <span className="chat-conversation-titleline">
        <b className="chat-conversation-title">{conversationTitle(conversation)}</b>
        {folder==='groups'&&<small className="chat-conversation-kind">{conversationKind(conversation)}</small>}
       </span>
       <span className="chat-conversation-preview">{conversation.last_message_body||'بدون پیام'}</span>
      </span>
      {row.unreadCount>0&&<span className="chat-conversation-unread" aria-label={row.unreadCount+' پیام خوانده‌نشده'}>{row.unreadCount}</span>}
     </button>;
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
        {unread>0&&<span className="chat-shipment-unread" aria-label={unread+' پیام خوانده‌نشده'}>{unread}</span>}
       </button>;
      })}
     </div>}
    </article>;
   })}
  </div>}

  {rows.length===0&&<div className="chat-conversation-empty"><span className="chat-conversation-empty-icon"><Users size={23}/></span><b>{emptyLabel}</b><span>{folder==='unread'?'همهٔ گفتگوها به‌روز هستند.':'برای شروع، یک گفتگو یا گروه تازه بسازید.'}</span></div>}
 </div>;
};
