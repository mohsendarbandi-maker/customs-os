import React, { useEffect, useState } from 'react';
import { Anchor, CheckCircle2, Loader2, Save, Ship, MapPin, Clock3 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Props = { caseId: string; onMessage?: (type: 'success' | 'error' | 'info', text: string) => void };

type Form = {
  shippingLine: string; billOfLading: string; billYear: string; vesselName: string; imo: string; flag: string; voyage: string;
  originPort: string; destinationPort: string; cargoCount: string; cargoUnit: string; netWeight: string; grossWeight: string;
  tallyNo: string; releaseInvoiceNo: string; releaseInvoiceDate: string; releaseStatus: string; electronicReleaseNo: string;
};

const statuses = [
  ['draft','پیش‌نویس','Draft'], ['booking_confirmed','تأیید رزرو','Booking Confirmed'], ['loading','در حال بارگیری','Loading'],
  ['loaded','بارگیری کامل','Loaded'], ['departed','حرکت از مبدأ','Departed'], ['in_transit','در مسیر','In Transit'],
  ['approaching_destination','در حال نزدیک شدن به مقصد','Approaching Destination'], ['anchorage','صف لنگرگاه','Anchorage'],
  ['berthing','در حال پهلوگیری','Berthing'], ['discharging','در حال تخلیه','Discharging'], ['discharged','تخلیه کامل','Discharged'],
  ['completed','تکمیل‌شده','Completed'], ['delayed','تأخیر','Delayed'], ['cancelled','لغوشده','Cancelled']
] as const;

const events = [
  ['draft','پیش‌نویس / Draft'], ['booking_confirmed','تأیید رزرو / Booking Confirmed'], ['loading_start','شروع بارگیری / Loading Start'],
  ['loading_complete','پایان بارگیری / Loading Complete'], ['departed','حرکت / Departed'], ['in_transit','در مسیر / In Transit'],
  ['approaching_destination','نزدیک مقصد / Approaching Destination'], ['anchorage_arrived','ورود به لنگرگاه / Anchorage'],
  ['berthing','پهلوگیری / Berthing'], ['discharge_start','شروع تخلیه / Discharge Start'], ['discharge_complete','پایان تخلیه / Discharge Complete'],
  ['completed','تکمیل / Completed'], ['delayed','تأخیر / Delayed'], ['cancelled','لغو / Cancelled']
] as const;

const Field = ({ label, value, onChange, placeholder = '' }: {label:string;value:string;onChange:(v:string)=>void;placeholder?:string}) => (
  <label className="block"><span className="block text-xs text-slate-400 mb-1.5">{label}</span><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-cyan-500" /></label>
);

const initialForm: Form = { shippingLine:'', billOfLading:'', billYear:String(new Date().getFullYear()), vesselName:'', imo:'', flag:'', voyage:'', originPort:'', destinationPort:'', cargoCount:'', cargoUnit:'', netWeight:'', grossWeight:'', tallyNo:'', releaseInvoiceNo:'', releaseInvoiceDate:'', releaseStatus:'pending', electronicReleaseNo:'' };

export const MaritimeTab: React.FC<Props> = ({ caseId, onMessage }) => {
  const [form, setForm] = useState<Form>(initialForm);
  const [status, setStatus] = useState('draft');
  const [location, setLocation] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [timeType, setTimeType] = useState('actual');
  const [notes, setNotes] = useState('');
  const [eventsHistory, setEventsHistory] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [shipmentId, setShipmentId] = useState('');

  const msg = (t:'success'|'error'|'info', s:string) => onMessage?.(t,s);
  const set = (k:keyof Form, v:string) => setForm(p=>({...p,[k]:v}));
  const num = (v:string) => v.trim() ? Number(v.replace(/,/g,'')) : null;
  const dateOnly = (v:string) => {
    const raw=v.trim(); if(!raw) return null;
    const normalized=raw.replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[.-]/g,'/');
    const p=normalized.split('/').map(Number);
    if(p.length!==3 || p.some(n=>!Number.isFinite(n))) return raw;
    const [y,m,d]=p;
    if(y>=1900 && y<=2200) return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if(y<1300 || y>1600) return raw;
    const target=`${y}-${m}-${d}`;
    const fmt=new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',month:'numeric',day:'numeric',timeZone:'UTC'});
    const start=Date.UTC(y+621,2,19);
    for(let i=0;i<380;i++) { const dt=new Date(start+i*86400000); const parts=fmt.formatToParts(dt); const py=Number(parts.find(x=>x.type==='year')?.value), pm=Number(parts.find(x=>x.type==='month')?.value), pd=Number(parts.find(x=>x.type==='day')?.value); if(`${py}-${pm}-${pd}`===target) return dt.toISOString().slice(0,10); }
    return raw;
  };

  const load = async () => {
    if(!caseId) return;
    const {data,error}=await supabase.from('shipments').select('*').eq('case_id',caseId).maybeSingle();
    if(error) return;
    if(data){ setShipmentId(data.id); setStatus(data.current_status||'draft'); setLocation(data.current_location||''); setForm({shippingLine:data.shippinging_line||data.shipping_line||'',billOfLading:data.bill_of_lading_no||'',billYear:String(data.bill_of_lading_year||new Date().getFullYear()),vesselName:'',imo:'',flag:'',voyage:data.voyage_no||'',originPort:data.origin_port||'',destinationPort:data.destination_port||'',cargoCount:data.cargo_count==null?'':String(data.cargo_count),cargoUnit:data.cargo_count_unit||'',netWeight:data.net_weight_kg==null?'':String(data.net_weight_kg),grossWeight:data.gross_weight_kg==null?'':String(data.gross_weight_kg),tallyNo:data.tally_no||'',releaseInvoiceNo:data.release_invoice_no||'',releaseInvoiceDate:data.release_invoice_date||'',releaseStatus:data.release_status||'pending',electronicReleaseNo:data.electronic_release_no||''});
      const v=data.vessel_id ? await supabase.from('vessels').select('name,imo_number,flag_code').eq('id',data.vessel_id).maybeSingle() : null;
      if(v?.data) setForm(p=>({...p,vesselName:v.data.name||'',imo:v.data.imo_number||'',flag:v.data.flag_code||''}));
      const h=await supabase.from('shipment_tracking_events').select('*').eq('shipment_id',data.id).order('event_time',{ascending:false}).limit(30); if(!h.error) setEventsHistory(h.data||[]);
    }
  };
  useEffect(()=>{load()},[caseId]);

  const save = async () => {
    if(!caseId) return msg('error','ابتدا یک پرونده ایجاد یا انتخاب کن.');
    if(!form.shippingLine.trim()||!form.billOfLading.trim()||!form.vesselName.trim()) return msg('error','کشتیرانی، شماره B/L و نام کشتی الزامی است.');
    setSaving(true); msg('info','در حال ذخیره پرونده کشتیرانی...');
    try {
      const {data,error}=await supabase.rpc('update_shipment_maritime_data',{p_case_id:caseId,p_shipping_line:form.shippingLine,p_bill_of_lading_no:form.billOfLading,p_bill_of_lading_year:Number(form.billYear),p_vessel_name:form.vesselName,p_vessel_imo:form.imo||null,p_vessel_flag_code:form.flag.toUpperCase()||null,p_voyage_no:form.voyage||null,p_origin_port:form.originPort||null,p_destination_port:form.destinationPort||null,p_cargo_count:num(form.cargoCount),p_cargo_count_unit:form.cargoUnit||null,p_net_weight_kg:num(form.netWeight),p_gross_weight_kg:num(form.grossWeight),p_tally_no:form.tallyNo||null,p_release_invoice_no:form.releaseInvoiceNo||null,p_release_invoice_date:dateOnly(form.releaseInvoiceDate),p_release_status:form.releaseStatus||null,p_electronic_release_no:form.electronicReleaseNo||null});
      if(error) throw error; setShipmentId(data); msg('success','پرونده کشتیرانی و اطلاعات B/L ذخیره شد.'); await load();
    } catch(e:any){msg('error',`خطا در ذخیره کشتیرانی: ${e?.message||'خطای نامشخص'}`)} finally{setSaving(false)}
  };

  const changeStatus = async () => {
    if(!shipmentId) return msg('error','ابتدا اطلاعات کشتیرانی را ذخیره کن.');
    setSaving(true);
    try { const {error}=await supabase.rpc('set_shipment_tracking_status',{p_shipment_id:shipmentId,p_status:status,p_location:location||null,p_event_time:eventTime?new Date(eventTime).toISOString():new Date().toISOString(),p_time_type:timeType,p_notes:notes||null,p_source:'Customs OS'}); if(error) throw error; setNotes(''); msg('success','وضعیت و رویداد کشتیرانی ثبت شد.'); await load(); }
    catch(e:any){msg('error',`خطا در ثبت وضعیت: ${e?.message||'خطای نامشخص'}`)} finally{setSaving(false)}
  };

  return <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 max-w-7xl">
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6"><div><h1 className="text-lg font-bold flex items-center gap-2"><Anchor className="text-cyan-400"/> پرونده کشتیرانی / Maritime Shipment File</h1><p className="text-xs text-slate-500 mt-1">پیش‌نویس B/L مستقل از ثبت سفارش و اظهار؛ مطابق چرخه عملیاتی بین‌المللی حمل دریایی.</p></div><span className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">Shipment: <span dir="ltr">{shipmentId||'—'}</span></span></div>
    <div className="grid md:grid-cols-4 gap-4"><Field label="کشتیرانی / Shipping Line *" value={form.shippingLine} onChange={v=>set('shippingLine',v)}/><Field label="شماره B/L *" value={form.billOfLading} onChange={v=>set('billOfLading',v)}/><Field label="سال B/L / Year" value={form.billYear} onChange={v=>set('billYear',v)}/><Field label="Voyage Number" value={form.voyage} onChange={v=>set('voyage',v)}/><Field label="نام کشتی / Vessel *" value={form.vesselName} onChange={v=>set('vesselName',v)}/><Field label="IMO Number" value={form.imo} onChange={v=>set('imo',v)} placeholder="1234567"/><Field label="پرچم / Flag (ISO-2)" value={form.flag} onChange={v=>set('flag',v)} placeholder="IR"/><Field label="بندر بارگیری / POL" value={form.originPort} onChange={v=>set('originPort',v)}/><Field label="بندر تخلیه / POD" value={form.destinationPort} onChange={v=>set('destinationPort',v)}/><Field label="تعداد / Quantity" value={form.cargoCount} onChange={v=>set('cargoCount',v)}/><Field label="واحد / Unit" value={form.cargoUnit} onChange={v=>set('cargoUnit',v)} placeholder="Roll / رول"/><Field label="وزن خالص kg / Net" value={form.netWeight} onChange={v=>set('netWeight',v)}/><Field label="وزن ناخالص kg / Gross" value={form.grossWeight} onChange={v=>set('grossWeight',v)}/><Field label="شماره بارشماری / Tally" value={form.tallyNo} onChange={v=>set('tallyNo',v)}/><Field label="شماره ترخیصیه / Release Invoice" value={form.releaseInvoiceNo} onChange={v=>set('releaseInvoiceNo',v)}/><Field label="تاریخ ترخیصیه" value={form.releaseInvoiceDate} onChange={v=>set('releaseInvoiceDate',v)} placeholder="1405/02/29 یا 2026-05-20"/><Field label="ترخیصیه الکترونیک / e-Release" value={form.electronicReleaseNo} onChange={v=>set('electronicReleaseNo',v)}/></div>
    <div className="mt-5 flex flex-wrap gap-3 items-end"><label className="block"><span className="block text-xs text-slate-400 mb-1.5">وضعیت ترخیصیه / Release Status</span><select value={form.releaseStatus} onChange={e=>set('releaseStatus',e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm"><option value="pending">Pending</option><option value="invoice_received">Invoice Received</option><option value="paid">Paid</option><option value="released">Released</option></select></label><button onClick={save} disabled={saving} className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 font-bold text-sm"><Save size={16} className="inline ml-2"/> ذخیره / Save Maritime File</button></div>
    <div className="mt-7 border-t border-slate-800 pt-6"><h2 className="font-bold flex items-center gap-2 mb-4"><Ship className="text-cyan-400" size={18}/> کنترل موقعیت و وضعیت کشتی / Vessel Tracking</h2><div className="grid md:grid-cols-4 gap-4 items-end"><label className="block md:col-span-2"><span className="block text-xs text-slate-400 mb-1.5">وضعیت / Status</span><select value={status} onChange={e=>setStatus(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm">{statuses.map(s=><option key={s[0]} value={s[0]}>{s[1]} / {s[2]}</option>)}</select></label><Field label="موقعیت / Location" value={location} onChange={setLocation} placeholder="Port / Anchorage / At Sea"/><label className="block"><span className="block text-xs text-slate-400 mb-1.5">زمان / Event Time</span><input type="datetime-local" value={eventTime} onChange={e=>setEventTime(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm"/></label><label className="block"><span className="block text-xs text-slate-400 mb-1.5">نوع زمان / Time Type</span><select value={timeType} onChange={e=>setTimeType(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm"><option value="estimated">Estimated</option><option value="requested">Requested</option><option value="planned">Planned</option><option value="actual">Actual</option></select></label><label className="block md:col-span-3"><span className="block text-xs text-slate-400 mb-1.5">یادداشت / Notes</span><input value={notes} onChange={e=>setNotes(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm"/></label><button onClick={changeStatus} disabled={saving} className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold text-sm"><Clock3 size={16} className="inline ml-2"/> ثبت رویداد / Record Event</button></div></div>
    <div className="mt-7 border-t border-slate-800 pt-6"><h2 className="font-bold mb-3">چرخه وضعیت / International Status Lifecycle</h2><div className="flex gap-2 overflow-x-auto pb-2">{statuses.map((s,i)=><div key={s[0]} className={`shrink-0 px-3 py-2 rounded-xl border text-xs ${status===s[0]?'border-cyan-500 bg-cyan-500/10 text-cyan-300':'border-slate-800 bg-slate-950 text-slate-500'}`}><span className="font-bold">{i+1}.</span> {s[1]}<div dir="ltr" className="text-[10px] mt-1">{s[2]}</div></div>)}</div></div>
    <div className="mt-7 border-t border-slate-800 pt-6"><h2 className="font-bold mb-3 flex items-center gap-2"><MapPin size={17}/> تاریخچه رویدادها / Event History</h2>{eventsHistory.length===0?<div className="text-sm text-slate-500">هنوز رویدادی ثبت نشده است.</div>:<div className="space-y-2">{eventsHistory.map((e:any)=><div key={e.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs grid md:grid-cols-4 gap-2"><b>{events.find(x=>x[0]===e.event_code)?.[1]||e.event_code}</b><span>{e.event_time?new Date(e.event_time).toLocaleString('fa-IR'): '—'}</span><span>{e.time_type||'—'} · {e.location||'—'}</span><span>{e.notes||'—'}</span></div>)}</div>}</div>
  </section>;
};
