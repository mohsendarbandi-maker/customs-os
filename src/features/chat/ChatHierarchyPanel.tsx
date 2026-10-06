import React,{useCallback,useEffect,useMemo,useState}from'react';
import{ChevronDown,ChevronLeft,Hash,Package,RefreshCw,Users}from'lucide-react';
import type{ChatConversation}from'./types';
import{listChatHierarchy,type ChatHierarchyItem}from'./api';
import{normalizeFaText}from'../../lib/jalali';

type ChatFolder = 'all' | 'coworkers' | 'groups' | 'owners' | 'shipments' | 'unread';

type Props={
 selectedId:string|null;
 onSelect:(id:string)=>void;
 fallback:ChatConversation[];
 folder?:ChatFolder;
};

export const ChatHierarchyPanel:React.FC<Props>=({selectedId,onSelect,fallback,folder='all'})=>{
 const[items,setItems]=useState<ChatHierarchyItem[]>([]);
 const[open,setOpen]=useState<Record<string,boolean>>({});
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState<string|null>(null);

 const load=useCallback(async()=>{
  setLoading(true);
  try{
   const data=await listChatHierarchy();
   setItems(data);
   setOpen(previous=>{
    const next={...previous};
    for(const item of data){
     if(item.hierarchy_kind==='owner_group'&&next[item.conversation_id]===undefined)next[item.conversation_id]=true;
    }
    return next;
   });
   setError(null);
  }catch(e){
   setError(e instanceof Error?e.message:'ساختار محموله‌ها دریافت نشد.');
  }finally{setLoading(false)}
 },[]);

 useEffect(()=>{void load()},[load]);

 const owners=useMemo(
  ()=>items.filter(item=>item.hierarchy_kind==='owner_group'),
  [items],
 );

 const shipmentsByOwner=useMemo(()=>{
  const result=new Map<string,ChatHierarchyItem[]>();
  for(const item of items){
   if(item.hierarchy_kind!=='shipment_group'||!item.parent_conversation_id)continue;
   const list=result.get(item.parent_conversation_id)??[];
   list.push(item);
   result.set(item.parent_conversation_id,list);
  }
  return result;
 },[items]);

 const regular=fallback.filter(item=>{
  if(item.hierarchy_kind==='owner_group'||item.hierarchy_kind==='shipment_group')return false;
  if(folder==='coworkers')return item.type==='direct';
  if(folder==='groups')return ['group','company_channel','shared_company'].includes(item.type);
  if(folder==='unread')return Number(item.unread_count)>0;
  return true;
 });
 const visibleOwners=owners.filter(owner=>{
  if(folder==='groups'||folder==='coworkers')return false;
  if(folder==='shipments')return false;
  if(folder==='unread'){
   const children=shipmentsByOwner.get(owner.conversation_id)??[];
   return Number(owner.unread_count)>0||children.some(item=>Number(item.unread_count)>0);
  }
  return folder==='all'||folder==='owners';
 });


 return <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
  <div className="px-3 py-2 flex items-center justify-between border-b app-border">
   <div>
    <b className="text-xs">ساختار تیم و محموله</b>
    <div className="text-[10px] app-muted mt-0.5">صاحب کالا ← محموله</div>
   </div>
   <button type="button" className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" onClick={()=>void load()} aria-label="به‌روزرسانی ساختار">
    <RefreshCw size={14} className={loading?'animate-spin':''}/>
   </button>
  </div>

  {error&&<div className="mx-3 mt-3 rounded-xl bg-red-500/10 text-red-700 dark:text-red-300 px-3 py-2 text-[11px]">{error}</div>}

  {loading&&!items.length
   ?<div className="p-5 app-muted text-sm">در حال ساخت ساختار محموله‌ها…</div>
   :owners.length===0
    ?<div className="p-5 app-muted text-sm">برای این حساب هنوز گروه محموله‌ای ساخته نشده است.</div>
    :<div className="p-2">
      {visibleOwners.map(owner=>{
       const children=shipmentsByOwner.get(owner.conversation_id)??[];
       const expanded=open[owner.conversation_id]??true;
       const selectedOwner=selectedId===owner.conversation_id;
       return <div key={owner.conversation_id} className="mb-1">
        <div className={"flex items-center gap-1 rounded-xl "+(selectedOwner?'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]':'')}>
         <button type="button" className="h-11 w-10 shrink-0 rounded-xl flex items-center justify-center" onClick={()=>setOpen(previous=>({...previous,[owner.conversation_id]:!expanded}))} aria-label={expanded?'بستن محموله‌ها':'باز کردن محموله‌ها'}>
          {expanded?<ChevronDown size={16}/>:<ChevronLeft size={16}/>}
         </button>
         <button type="button" className="min-w-0 flex-1 flex items-center gap-3 text-right py-2.5" onClick={()=>{onSelect(owner.conversation_id);setOpen(previous=>({...previous,[owner.conversation_id]:true}))}}>
          <div className="h-11 w-11 shrink-0 rounded-full bg-[var(--primary)] text-white flex items-center justify-center"><Users size={18}/></div>
          <div className="min-w-0 flex-1">
           <b className="block truncate text-[14px]">{normalizeFaText(owner.title||'گروه صاحب کالا')}</b>
           <div className="text-[10px] app-muted mt-0.5">{children.length} محموله</div>
          </div>
         </button>
        </div>

        {(expanded && folder!=='owners')&&<div className="mr-5 pr-2 border-r app-border">
         {children.map(shipment=>{
          const selected=selectedId===shipment.conversation_id;
          const name=shipment.shipment_display_name||shipment.title||'محموله';
          const ref=shipment.shipment_bl_number||'بدون شماره بارنامه';
          return <button type="button" key={shipment.conversation_id} onClick={()=>onSelect(shipment.conversation_id)} className={"w-full min-h-[68px] rounded-xl flex items-center gap-2 text-right px-3 py-2 mb-1 "+(selected?'bg-[var(--primary)] text-white':'hover:bg-black/5 dark:hover:bg-white/5')}>
           <div className={"h-9 w-9 shrink-0 rounded-lg flex items-center justify-center "+(selected?'bg-white/15':'bg-[var(--primary)]/10 text-[var(--primary)]')}><Package size={15}/></div>
           <div className="min-w-0 flex-1">
            <b className="block truncate text-[13px]">{normalizeFaText(name)}</b>
            <div className={"text-[10px] truncate mt-1 "+(selected?'text-white/70':'app-muted')}>{ref}</div>
           </div>
           <Hash size={12} className={selected?'text-white/60':'app-muted'}/>
          </button>
         })}
         {!children.length&&<div className="px-3 py-3 text-[10px] app-muted">هنوز محموله‌ای برای این صاحب کالا ثبت نشده است.</div>}
        </div>}
       </div>
      })}
    </div>}

  {regular.length>0&&<div className="border-t app-border mt-1 p-2">
   <div className="px-2 py-2 text-[10px] font-bold app-muted">گفتگوهای دیگر</div>
   {regular.map(c=><button type="button" key={c.conversation_id} onClick={()=>onSelect(c.conversation_id)} className={"w-full text-right px-3 py-3 rounded-xl flex items-center gap-3 "+(selectedId===c.conversation_id?'bg-[var(--primary)] text-white':'hover:bg-black/5 dark:hover:bg-white/5')}>
    <div className={"h-10 w-10 shrink-0 rounded-full flex items-center justify-center "+(selectedId===c.conversation_id?'bg-white/15':'bg-[var(--primary)]/10 text-[var(--primary)]')}>{c.type==='company_channel'?<Hash size={16}/>:<Users size={16}/>}</div>
    <div className="min-w-0 flex-1"><b className="block truncate text-[13px]">{c.display_name||c.title||'گفتگو'}</b><div className={"text-[10px] truncate mt-1 "+(selectedId===c.conversation_id?'text-white/70':'app-muted')}>{c.last_message_body||'هنوز پیامی ثبت نشده است'}</div></div>
   </button>)}
  </div>}
 </div>;
};
