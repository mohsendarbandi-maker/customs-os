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

 return <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
  {(folder==='all'||folder==='groups')&&<div className="px-3 py-2 flex items-center border-b app-border"><b className="text-xs">{folder==='groups'?'گروه‌ها و کانال‌ها':'گفتگوها'}</b></div>}

  {folder!=='owners'&&folder!=='shipments'&&regular.length>0&&<div className="p-2">
   {regular.map(conversation=>{
    const selected=selectedId===conversation.conversation_id;
    return <button type="button" key={conversation.conversation_id} onClick={()=>onSelect(conversation.conversation_id)} className={"w-full min-h-[68px] rounded-xl flex items-center gap-3 text-right px-3 py-2 mb-1 "+(selected?'bg-[var(--primary)] text-white':'hover:bg-black/5 dark:hover:bg-white/5')}>
     <div className={"h-10 w-10 shrink-0 rounded-full grid place-items-center "+(selected?'bg-white/15':'bg-[var(--primary)]/10 text-[var(--primary)]')}>
      {conversation.type==='direct'?<span className="font-black text-sm">{(conversation.display_name||'ک').slice(0,1)}</span>:<Users size={17}/>}
     </div>
     <div className="min-w-0 flex-1">
      <b className="block truncate text-[13px]">{normalizeFaText(conversation.display_name||conversation.title||'گفتگو')}</b>
      <div className={"text-[10px] truncate mt-1 "+(selected?'text-white/70':'app-muted')}>{conversation.last_message_body||'بدون پیام'}</div>
     </div>
     {Number(conversation.unread_count)>0&&<span className={"min-w-6 h-6 rounded-full text-[10px] flex items-center justify-center "+(selected?'bg-white/20 text-white':'bg-[var(--primary)] text-white')}>{conversation.unread_count}</span>}
    </button>;
   })}
  </div>}

  {regular.length===0&&visibleOwners.length===0&&<div className="p-8 text-center app-muted text-sm">گفتگویی برای این بخش پیدا نشد.</div>}

  {visibleOwners.length>0&&<div className="p-2">
   {(folder==='all'||folder==='owners'||folder==='shipments'||folder==='unread')&&<div className="px-2 py-2 text-[10px] font-bold app-muted">{folder==='owners'?'صاحب کالاها':folder==='shipments'?'محموله‌ها':'ساختار صاحب کالا و محموله'}</div>}
   {visibleOwners.map(owner=>{
    const children=shipmentsByOwner.get(owner.conversation_id)??[];
    const expanded=folder==='owners'?false:(open[owner.conversation_id]??true);
    const selectedOwner=selectedId===owner.conversation_id;
    return <div key={owner.conversation_id} className="mb-1">
     <div className={"flex items-center gap-1 rounded-xl "+(selectedOwner?'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]':'')}>
      <button type="button" className="h-11 w-10 shrink-0 rounded-xl flex items-center justify-center" onClick={()=>setOpen(previous=>({...previous,[owner.conversation_id]:!expanded}))} aria-label={expanded?'بستن محموله‌ها':'باز کردن محموله‌ها'}>
       {expanded?<ChevronDown size={16}/>:<ChevronLeft size={16}/>}
      </button>
      <button type="button" className="min-w-0 flex-1 flex items-center gap-3 text-right py-2.5" onClick={()=>{onSelect(owner.conversation_id);setOpen(previous=>({...previous,[owner.conversation_id]:true}))}}>
       <div className="h-11 w-11 shrink-0 rounded-full bg-[var(--primary)] text-white flex items-center justify-center"><Users size={18}/></div>
       <div className="min-w-0 flex-1"><b className="block truncate text-[14px]">{normalizeFaText(owner.title||'صاحب کالا')}</b><div className="text-[10px] app-muted mt-0.5">{children.length} محموله</div></div>
      </button>
     </div>
     {expanded&&children.length>0&&<div className="mr-5 pr-2 border-r app-border">
      {children.map(shipment=>{
       const selected=selectedId===shipment.conversation_id;
       return <button type="button" key={shipment.conversation_id} onClick={()=>onSelect(shipment.conversation_id)} className={"w-full min-h-[68px] rounded-xl flex items-center gap-2 text-right px-3 py-2 mb-1 "+(selected?'bg-[var(--primary)] text-white':'hover:bg-black/5 dark:hover:bg-white/5')}>
        <div className={"h-9 w-9 shrink-0 rounded-lg flex items-center justify-center "+(selected?'bg-white/15':'bg-[var(--primary)]/10 text-[var(--primary)]')}><Package size={15}/></div>
        <div className="min-w-0 flex-1"><b className="block truncate text-[13px]">{normalizeFaText(shipment.shipment_display_name||shipment.title||'محموله')}</b><div className={"text-[10px] truncate mt-1 "+(selected?'text-white/70':'app-muted')}>{shipment.shipment_bl_number||'بدون شماره بارنامه'}</div></div>
       </button>;
      })}
     </div>}
    </div>;
   })}
  </div>}
 </div>;
};
