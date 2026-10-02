import React from 'react';
import {Link} from 'react-router-dom';
import {AlertCircle,ArrowLeft,Bell} from 'lucide-react';
import {addJalaliDays,startOfTehranDay} from '../../lib/jalali';
import {useQuery} from '@tanstack/react-query';
import {supabase} from '../../lib/supabase';
export const RemindersHomeCard:React.FC=()=>{
 const {data}=useQuery({queryKey:['reminders-home-card'],queryFn:async()=>{const now=new Date();const start=startOfTehranDay(now);const end=addJalaliDays(start,1);const [open,overdue]=await Promise.all([
  supabase.from('operational_reminders').select('id',{count:'exact',head:true}).eq('status','open').gte('due_at',start.toISOString()).lt('due_at',end.toISOString()),
  supabase.from('operational_reminders').select('id',{count:'exact',head:true}).eq('status','open').lt('due_at',now.toISOString())
 ]);return{today:open.count??0,overdue:overdue.count??0};},staleTime:30000});
 return <div className="border app-border bg-[var(--surface)] rounded-3xl p-4 mt-3"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><div className="w-10 h-10 rounded-xl bg-[var(--primary)]/10 grid place-items-center"><Bell size={18}/></div><div><h2 className="font-black text-sm">یادآورها</h2><p className="text-[10px] app-muted mt-1">امروز و معوق</p></div></div><Link to="/reminders" className="min-h-11 px-3 rounded-xl border app-border inline-flex items-center gap-1 text-xs font-bold">مشاهده<ArrowLeft size={14}/></Link></div><div className="grid grid-cols-2 gap-2 mt-3"><div className="rounded-2xl bg-[var(--surface-2)] p-3"><div className="text-2xl font-black">{data?.today??0}</div><div className="text-[10px] app-muted">باز</div></div><div className="rounded-2xl bg-red-500/10 p-3"><div className="text-2xl font-black flex items-center gap-1">{data?.overdue??0}<AlertCircle size={15}/></div><div className="text-[10px] app-muted">معوق</div></div></div></div>;
};
