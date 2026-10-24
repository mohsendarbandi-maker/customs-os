import React,{useMemo}from'react';
import{ChevronDown,ChevronLeft,Package,Users}from'lucide-react';
import type{ChatConversation}from'./types';
import{normalizeFaText}from'../../lib/jalali';

type ChatFolder='all'|'coworkers'|'groups'|'owners'|'shipments'|'unread';

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

export const ChatHierarchyPanel:React.FC<Props>=({selectedId,onSelect,conversations,folder='all'})=>{
 const[open,setOpen]=React.useState<Record<string,boolean>>({});

 const owners=useMemo(
  ()=>conversations.filter(item=>item.hierarchy_kind==='owner_group'),
  [conversations],
 );

 const shipmentsByOwner=useMemo(()=>{
  const result=new Map<string,ChatConversation[]>();
  for(const item of conversations){
   if(item.hierarchy_kind!=='shipment_group'||!item.parent_conversation_id)continue;
   const list=result.get(item.parent_conversation_id)??[];
   list.push(item);
   result.set(item.parent_conversation_id,list);
  }
  return result;
 },[conversations]);

 const regular=useMemo(()=>conversations.filter(item=>{
  if(item.hierarchy_kind==='owner_group'||item.hierarchy_kind==='shipment_group')return false;
  if(folder==='coworkers')return item.type==='direct';
  if(folder==='groups')return ['group','company_channel','shared_company'].includes(item.type);
  if(folder==='unread')return Number(item.unread_count)>0;
  if(folder==='owners'||folder==='shipments')return false;
  return true;
 }),[conversations,folder]);

 const visibleOwners=useMemo(()=>owners.filter(owner=>{
  if(folder==='groups'||folder==='coworkers')return false;
  if(folder==='unread'){
   const children=shipmentsByOwner.get(owner.conversation_id)??[];
   return Number(owner.unread_count)>0||children.some(item=>Number(item.unread_count)>0);
  }
  return folder==='all'||folder==='owners'||folder==='shipments';
 }),[folder,owners,shipmentsByOwner]);

 const emptyLabel=folder==='groups'?'هنوز گروه یا کانالی ساخته نشده است.':
  folder==='coworkers'?'گفتگوی مستقیمی پیدا نشد.':
  folder==='owners'?'گروه صاحب کالایی وجود ندارد.':
  folder==='shipments'?'گروه محموله‌ای برای نمایش وجود ندارد.':
  folder==='unread'?'پیام خوانده‌نشده‌ای وجود ندارد.':
  'هنوز گفتگویی وجود ندارد.';

 return <div className="chat-hierarchy-panel flex-1 min-h-0 overflow-y-auto overscroll-contain">
  {regular.length>0&&<div className="chat-conversation-list">
   {regular.map(conversation=>{
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
     {Number(conversation.unread_count)>0&&<span className="chat-conversation-unread" aria-label={conversation.unread_count+' پیام خوانده‌نشده'}>{conversation.unread_count}</span>}
    </button>;
   })}
  </div>}

  {visibleOwners.length>0&&<section className="chat-owner-tree">
   <div className="chat-owner-tree-heading">
    {folder==='owners'?'گروه‌های صاحب کالا':folder==='shipments'?'گروه‌های محموله':folder==='unread'?'گروه‌های دارای پیام جدید':'صاحب کالا و محموله'}
   </div>
   {visibleOwners.map(owner=>{
    const children=shipmentsByOwner.get(owner.conversation_id)??[];
    const expanded=folder==='owners'?false:folder==='shipments'?true:(open[owner.conversation_id]??false);
    const selectedOwner=selectedId===owner.conversation_id;
    const unreadCount=(Number(owner.unread_count)||0)+children.reduce((total,item)=>total+(Number(item.unread_count)||0),0);
    return <article key={owner.conversation_id} className={'chat-owner-card '+(selectedOwner?'is-selected':'')}>
     <div className="chat-owner-row">
      {folder==='owners'
       ?<span className="chat-owner-toggle is-static" aria-hidden="true"><ChevronLeft size={17}/></span>
       :<button type="button" className="chat-owner-toggle" onClick={()=>setOpen(previous=>({...previous,[owner.conversation_id]:!expanded}))} aria-label={expanded?'بستن فهرست محموله‌ها':'باز کردن فهرست محموله‌ها'} aria-expanded={expanded}>
         {expanded?<ChevronDown size={17}/>:<ChevronLeft size={17}/>}
        </button>}
      <button type="button" className="chat-owner-select" onClick={()=>{onSelect(owner.conversation_id);setOpen(previous=>({...previous,[owner.conversation_id]:true}))}} aria-pressed={selectedOwner}>
       <span className="chat-owner-avatar"><Users size={19}/></span>
       <span className="chat-owner-copy">
        <span className="chat-owner-name">{normalizeFaText(owner.title||'صاحب کالا')}</span>
        <span className="chat-owner-meta"><span className="chat-owner-count">{children.length} محموله</span><span>گروه صاحب کالا</span></span>
       </span>
      </button>
      {unreadCount>0&&<span className="chat-owner-unread" aria-label={unreadCount+' پیام خوانده‌نشده'}>{unreadCount}</span>}
     </div>
     {expanded&&children.length>0&&<div className="chat-shipment-list">
      {children.map(shipment=>{
       const selected=selectedId===shipment.conversation_id;
       return <button type="button" key={shipment.conversation_id} onClick={()=>onSelect(shipment.conversation_id)} className={'chat-shipment-row '+(selected?'is-selected':'')} aria-pressed={selected}>
        <span className="chat-shipment-icon"><Package size={17}/></span>
        <span className="chat-shipment-copy">
         <span className="chat-shipment-name">{normalizeFaText(shipment.shipment_display_name||shipment.title||'محموله')}</span>
         <span className="chat-shipment-bl">{shipment.shipment_bl_number||'بدون شماره بارنامه'}</span>
        </span>
        {Number(shipment.unread_count)>0&&<span className="chat-shipment-unread">{shipment.unread_count}</span>}
       </button>;
      })}
     </div>}
    </article>;
   })}
  </section>}

  {regular.length===0&&visibleOwners.length===0&&<div className="chat-conversation-empty"><span className="chat-conversation-empty-icon"><Users size={23}/></span><b>{emptyLabel}</b><span>برای شروع، یک گفتگو یا گروه تازه ایجاد کنید.</span></div>}
 </div>;
};
