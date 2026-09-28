import React,{useCallback,useEffect,useState} from 'react';
import {ArrowRight,ExternalLink,LoaderCircle,MapPin,RefreshCw,Search,Ship,X} from 'lucide-react';
import {Link,useSearchParams} from 'react-router-dom';
import {supabase} from '../lib/supabase';

type Source={source:string;url:string;ok:boolean;name?:string|null;mmsi?:string|null;imo?:string|null;lat?:number|null;lon?:number|null;positionAt?:string|null;speed?:number|null;course?:number|null;region?:string|null;error?:string};
type VesselResult={imo:string;mmsi?:string|null;name?:string|null;sources:Source[];selected?:{lat:number;lon:number;sourceCount:number;sourceNames:string[];confidence:string}|null;checkedAt:string};

export const VesselSearchPage:React.FC=()=>{
  const[params]=useSearchParams();
  const imo=params.get('imo')||'';
  const name=params.get('name')||'';
  const bl=params.get('bl')||'';
  const[loading,setLoading]=useState(false);
  const[result,setResult]=useState<VesselResult|null>(null);
  const[error,setError]=useState('');
  const run=useCallback(async()=>{
    setError('');
    setResult(null);
    if(!/^\\d{7}$/.test(imo.replace(/\\D/g,''))){setError('برای فراخوانی رهگیری زنده، شماره IMO هفت‌رقمی لازم است.');return}
    setLoading(true);
    try{
      const{data,error:fnError}=await supabase.functions.invoke('vessel-multi-source',{body:{imo:imo.replace(/\\D/g,'')}});
      if(fnError)throw fnError;
      if(data?.error)throw new Error(data.error);
      setResult(data as VesselResult);
    }catch(e:any){setError(e?.message||'فراخوانی اطلاعات کشتی ناموفق بود.')}
    finally{setLoading(false)}
  },[imo]);
  useEffect(()=>{run()},[run]);
  const query=[name,imo,bl].filter(Boolean).join(' ');
  const q=encodeURIComponent(query||'vessel');
  const links=[['جستجوی عمومی کشتی','https://www.google.com/search?q='+q],['جستجوی اخبار و اعلامیه‌ها','https://www.google.com/search?tbm=nws&q='+q],['جستجو در وب با Bing','https://www.bing.com/search?q='+q]];
  const selected=result?.selected;
  const sourceWithPosition=result?.sources?.filter(x=>x.ok&&x.lat!=null&&x.lon!=null)||[];
  return <main dir="rtl" className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-4 md:p-6"><div className="max-w-5xl mx-auto">
    <header className="flex items-center justify-between gap-3 mb-6"><div><div className="text-[10px] app-muted">VESSEL INTELLIGENCE</div><h1 className="text-2xl font-black mt-1"><Ship className="inline text-cyan-400 ml-2"/> اطلاعات و رهگیری کشتی</h1><p className="text-xs app-muted mt-1">فراخوانی واقعی از سرویس چندمنبعی کشتیرانی و AIS انجام می‌شود.</p></div><div className="flex gap-1"><button onClick={run} disabled={loading} className="icon-btn" title="بازخوانی">{loading?<LoaderCircle size={17} className="animate-spin"/>:<RefreshCw size={17}/>}</button><Link to="/operations" className="icon-btn" title="بازگشت"><ArrowRight size={18}/></Link><Link to="/" className="icon-btn" title="بستن"><X size={18}/></Link></div></header>
    <section className="rounded-2xl border app-border bg-[var(--surface)] p-5"><div className="rounded-xl bg-[var(--surface-2)] p-4"><div className="text-xs app-muted">پرونده فراخوانی</div><div className="text-lg font-black mt-1" dir="ltr">{query||'—'}</div><div className="grid sm:grid-cols-3 gap-3 mt-4 text-xs"><div><span className="app-muted">نام کشتی</span><b className="block mt-1">{result?.name||name||'—'}</b></div><div><span className="app-muted">IMO</span><b className="block mt-1" dir="ltr">{result?.imo||imo||'—'}</b></div><div><span className="app-muted">MMSI</span><b className="block mt-1" dir="ltr">{result?.mmsi||'—'}</b></div></div></div>
    {error&&<div className="mt-4 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-sm">{error}</div>}
    {selected&&<div className="grid md:grid-cols-4 gap-3 mt-4"><div className="rounded-xl bg-[var(--surface-2)] p-4"><span className="text-xs app-muted">موقعیت</span><b className="block mt-2" dir="ltr">{selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}</b></div><div className="rounded-xl bg-[var(--surface-2)] p-4"><span className="text-xs app-muted">اعتماد</span><b className="block mt-2">{selected.confidence==='cross-source'?'تأیید چندمنبعی':'یک منبع'}</b></div><div className="rounded-xl bg-[var(--surface-2)] p-4"><span className="text-xs app-muted">منابع دارای موقعیت</span><b className="block mt-2">{selected.sourceCount}</b></div><a className="rounded-xl bg-[var(--surface-2)] p-4 hover:bg-[var(--surface-3)]" target="_blank" rel="noreferrer" href={'https://www.google.com/maps?q='+selected.lat+','+selected.lon}><span className="text-xs app-muted">نقشه</span><b className="block mt-2"><MapPin className="inline ml-1 text-cyan-400" size={15}/> باز کردن</b></a></div>}
    {sourceWithPosition.length>0&&<div className="mt-4 rounded-xl border app-border overflow-hidden"><div className="p-3 font-bold">منابع کشتیرانی و AIS</div>{sourceWithPosition.map((s,i)=><div key={s.source+i} className="grid md:grid-cols-[1fr_auto_auto_auto] gap-3 items-center p-3 border-t app-border text-xs"><b>{s.source}</b><span dir="ltr">{s.lat?.toFixed(4)}, {s.lon?.toFixed(4)}</span><span>{s.speed!=null?s.speed+' kn':'—'}</span><span>{s.region||'—'}</span></div>)}</div>}
    {result&&<div className="mt-3 text-[10px] app-muted">آخرین بررسی: {new Date(result.checkedAt).toLocaleString('fa-IR')}</div>}
    <div className="grid gap-3 mt-5">{links.map(([label,url])=><a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border app-border bg-[var(--surface-2)] hover:bg-[var(--surface-3)] p-4"><span className="font-bold text-sm"><Search className="inline ml-2 text-cyan-400" size={16}/>{label}</span><ExternalLink size={16} className="app-muted"/></a>)}</div>
    </section></div></main>
}