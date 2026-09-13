import React, { useEffect, useState } from 'react';
import { ArrowRight, Building2, Eye, EyeOff, Loader2, Save, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export const ClientRegistryPage: React.FC = () => {
  const [clients, setClients] = useState<any[]>([]);
  const [form, setForm] = useState({ name:'', nationalId:'', eplUsername:'', eplPassword:'' });
  const [selectedId, setSelectedId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ok:boolean;text:string}|null>(null);

  const load = async () => {
    const { data, error } = await supabase.from('clients').select('id,name,national_id,created_at').order('created_at',{ascending:false});
    if (!error) setClients(data || []);
  };
  useEffect(()=>{ load(); },[]);

  const save = async () => {
    if (!form.name.trim()) return setMessage({ok:false,text:'نام صاحب کالا الزامی است.'});
    if (!form.nationalId.trim()) return setMessage({ok:false,text:'شناسه ملی شرکت الزامی است.'});
    if (!form.eplUsername.trim() || !form.eplPassword) return setMessage({ok:false,text:'شناسه ملی اظهارکننده و رمز EPL را وارد کنید.'});
    setSaving(true); setMessage(null);
    try {
      let clientId = selectedId;
      if (clientId) {
        const { error } = await supabase.from('clients').update({name:form.name.trim(),national_id:form.nationalId.trim()}).eq('id',clientId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.rpc('create_client_workflow',{p_name:form.name.trim(),p_national_id:form.nationalId.trim()});
        if (error) throw error;
        clientId = data;
      }
      const { error: credError } = await supabase.rpc('save_client_epl_credentials',{p_client_id:clientId,p_epl_username:form.eplUsername.trim(),p_epl_password:form.eplPassword});
      if (credError) throw credError;
      setSelectedId(clientId); setForm(p=>({...p,eplPassword:''}));
      setMessage({ok:true,text:'صاحب کالا و اطلاعات ورود EPL با موفقیت ثبت شد. رمز در Vault رمزنگاری‌شده نگهداری می‌شود.'});
      await load();
    } catch(e:any) { setMessage({ok:false,text:e?.message || 'خطای نامشخص'}); }
    finally { setSaving(false); }
  };

  const selectClient = async (id:string) => {
    const c = clients.find(x=>x.id===id); if (!c) return;
    const {data} = await supabase.rpc('get_client_epl_credentials',{p_client_id:id});
    setSelectedId(id); setForm({name:c.name||'',nationalId:c.national_id||'',eplUsername:data?.[0]?.epl_username||'',eplPassword:''});
    setMessage(null);
  };

  return <main className="min-h-screen bg-slate-950 text-slate-100 p-5 md:p-8" dir="rtl">
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div><h1 className="text-2xl font-black flex items-center gap-2"><Building2 className="text-blue-400"/> ثبت صاحب کالا / Cargo Owner Registry</h1><p className="text-sm text-slate-400 mt-2">هر صاحب کالا مستقل از پرونده‌های گمرکی ثبت می‌شود و می‌تواند چندین ثبت سفارش و پرونده داشته باشد.</p></div>
        <Link to="/" className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900 text-sm"><ArrowRight className="inline ml-2" size={16}/> منوی اصلی</Link>
      </div>
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <div className="grid md:grid-cols-2 gap-4">
            <label><span className="text-xs text-slate-400">نام و نام شرکت *</span><input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3" placeholder="آذرفولاد امین"/></label>
            <label><span className="text-xs text-slate-400">شناسه ملی شرکت *</span><input value={form.nationalId} onChange={e=>setForm(p=>({...p,nationalId:e.target.value}))} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3" placeholder="شناسه ملی" dir="ltr"/></label>
            <label><span className="text-xs text-slate-400">شناسه ملی اظهارکننده / EPL Username *</span><input value={form.eplUsername} onChange={e=>setForm(p=>({...p,eplUsername:e.target.value}))} className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3" dir="ltr"/></label>
            <label><span className="text-xs text-slate-400">رمز عبور سامانه EPL *</span><div className="relative mt-1"><input type={showPassword?'text':'password'} value={form.eplPassword} onChange={e=>setForm(p=>({...p,eplPassword:e.target.value}))} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 pl-11" dir="ltr"/><button type="button" onClick={()=>setShowPassword(v=>!v)} className="absolute left-3 top-3 text-slate-400">{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
          </div>
          <div className="mt-5 rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200"><ShieldCheck className="inline ml-1" size={15}/> رمز EPL به صورت متن ساده در جدول عمومی ذخیره نمی‌شود و از Supabase Vault استفاده می‌شود.</div>
          {message && <div className={`mt-4 rounded-xl p-3 text-sm ${message.ok?'bg-emerald-950/40 text-emerald-300':'bg-red-950/40 text-red-300'}`}>{message.text}</div>}
          <button onClick={save} disabled={saving} className="mt-5 w-full md:w-auto px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold">{saving?<Loader2 className="inline ml-2 animate-spin" size={17}/>:<Save className="inline ml-2" size={17}/>} {selectedId?'ذخیره تغییرات':'ثبت صاحب کالا'}</button>
        </section>
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6"><h2 className="font-bold mb-4">صاحبان کالا / Cargo Owners</h2><div className="space-y-2 max-h-[500px] overflow-auto">{clients.length===0?<p className="text-sm text-slate-500">هنوز صاحب کالایی ثبت نشده است.</p>:clients.map(c=><button key={c.id} onClick={()=>selectClient(c.id)} className={`w-full text-right p-3 rounded-xl border ${selectedId===c.id?'border-blue-500 bg-blue-950/30':'border-slate-800 bg-slate-950/50'}`}><div className="font-bold">{c.name}</div><div className="text-xs text-slate-500 mt-1">شناسه ملی: {c.national_id||'—'}</div></button>)}</div></section>
      </div>
    </div>
  </main>;
};
