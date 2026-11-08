export type LocalFileManagerIndex = {
  schemaVersion: number;
  exportedAt: string;
  organizationId?: string;
  tables?: Record<string, Record<string, unknown>[]>;
  fileManager: {
    folders: Array<Record<string, unknown> & { relativePath: string }>;
    files: Array<Record<string, unknown> & { relativePath: string }>;
  };
  syncSummary?: Record<string, unknown>;
};

const safeJson = (value: unknown) => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function buildLocalFileManagerHtml(input: LocalFileManagerIndex): string {
  const payload = safeJson(input);
  return String.raw`<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">
<title>مدیریت محلی اسناد | Darbandi Commercial</title>
<style>
:root{font-family:Tahoma,"Segoe UI",sans-serif;color-scheme:light dark;--bg:#f3f6fb;--panel:#fff;--ink:#172338;--muted:#718096;--line:#e4eaf2;--accent:#126e82;--soft:#e8f5f7;--shadow:0 12px 34px #14243a12}
@media(prefers-color-scheme:dark){:root{--bg:#0c1422;--panel:#131f31;--ink:#e8eef8;--muted:#9aabc1;--line:#27364b;--accent:#67c6d2;--soft:#18333b;--shadow:0 12px 34px #0005}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink)}button,input{font:inherit}.shell{max-width:1500px;margin:auto;padding:26px}.hero{border-radius:24px;padding:28px;background:linear-gradient(125deg,#0d3447,#126e82 58%,#398e9c);color:white;box-shadow:var(--shadow)}.hero small{opacity:.78}.hero h1{margin:9px 0;font-size:clamp(22px,3vw,34px)}.hero p{margin:0;opacity:.85}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.stat,.panel{background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}.stat{padding:17px}.stat b{display:block;font-size:25px;margin-top:7px}.muted{color:var(--muted);font-size:12px}.layout{display:grid;grid-template-columns:320px minmax(0,1fr);gap:16px}.panel{padding:18px;min-width:0}.search{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink);margin:10px 0 14px}.tree{max-height:68vh;overflow:auto}.tree button,.file{width:100%;text-align:right;border:0;background:transparent;color:var(--ink);padding:10px;border-radius:10px;cursor:pointer}.tree button:hover,.tree button.active,.file:hover{background:var(--soft)}.tree button small{display:block;color:var(--muted);margin-top:4px}.files{display:grid;grid-template-columns:repeat(auto-fill,minmax(245px,1fr));gap:10px;margin-top:14px}.file{border:1px solid var(--line);padding:14px;min-height:105px}.file strong{display:block;overflow-wrap:anywhere}.file small{display:block;color:var(--muted);margin-top:8px}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.pill{background:var(--soft);color:var(--accent);padding:6px 10px;border-radius:99px;font-size:12px}.detail{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);border:1px solid var(--line);padding:14px;border-radius:12px;max-height:55vh;overflow:auto;font:12px/1.8 ui-monospace,monospace}.empty{padding:35px;text-align:center;color:var(--muted)}.notice{margin-top:14px;padding:12px;border-radius:12px;background:var(--soft);color:var(--accent);font-size:12px}
@media(max-width:800px){.shell{padding:12px}.stats{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}.tree{max-height:34vh}}

/* Local archive dashboard v2 */
.hero{position:relative;overflow:hidden;padding:34px 36px;border:1px solid #4cc6d455;background:radial-gradient(circle at 88% 10%,#38bdf866,transparent 28%),linear-gradient(120deg,#071b2c,#0b5268 56%,#173b73);box-shadow:0 24px 60px #06152633}
.hero:after{content:"";position:absolute;left:-55px;bottom:-145px;width:310px;height:310px;border:1px solid #a5f3fc44;border-radius:50%;box-shadow:0 0 0 28px #a5f3fc0a,0 0 0 58px #a5f3fc08}
.hero small{font-weight:900;letter-spacing:.2em;color:#a5f3fc}.hero h1{font-size:clamp(26px,4vw,42px);letter-spacing:-.04em}.hero p{max-width:720px;line-height:2}
.stats{gap:14px;margin:20px 0}.stat{position:relative;overflow:hidden;padding:19px;border-radius:18px;border-color:var(--line);background:linear-gradient(145deg,var(--panel),var(--bg));box-shadow:var(--shadow)}.stat:after{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--accent),#38bdf8)}.stat b{font-size:30px;font-weight:900;font-variant-numeric:tabular-nums}
.layout{grid-template-columns:340px minmax(0,1fr);align-items:start;gap:18px}.panel{padding:20px;border-radius:20px}.toolbar{justify-content:space-between}.toolbar strong{font-size:14px;font-weight:900}
.search{border-radius:13px;padding:13px 15px;background:var(--bg);box-shadow:inset 0 1px 3px #00000008}
.tree{max-height:70vh;padding-inline-end:3px}.tree button{position:relative;margin:2px 0;border:1px solid transparent;text-align:right;line-height:1.6}.tree button.active{border-color:#38bdf866;box-shadow:inset -3px 0 var(--accent)}.tree button small{font-size:10px}
.files{grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}.file{position:relative;min-height:128px;padding:16px;border-radius:15px;text-align:right;background:linear-gradient(145deg,var(--panel),var(--bg));transition:transform .18s,border-color .18s,box-shadow .18s}.file:hover{transform:translateY(-2px);border-color:var(--accent);box-shadow:0 12px 26px #00000012}.file strong{font-size:13px;line-height:1.8}.file small{font-size:10px;line-height:1.8;overflow-wrap:anywhere}
.detail{border-radius:15px;line-height:2}.notice{border:1px solid #0e749033;line-height:1.9}
@media(max-width:800px){.shell{padding:12px}.hero{padding:22px 18px;border-radius:19px}.stats{gap:9px}.stat{padding:13px}.stat b{font-size:24px}.layout{grid-template-columns:1fr}.panel{padding:14px;border-radius:16px}.tree{max-height:32vh}.files{grid-template-columns:1fr}}

</style></head><body><main class="shell">
<header class="hero"><small>DARBANDI COMMERCIAL · LOCAL ARCHIVE</small><h1>مدیریت محلی اسناد و پرونده‌ها</h1><p>نمایش آفلاین ساختار پوشه‌ها، اطلاعات محموله‌ها، اسناد گمرکی، کشتیرانی و گردش مالی</p></header>
<section class="stats" id="stats"></section><section class="layout"><aside class="panel"><div class="toolbar"><strong>ساختار پوشه‌ها</strong><span class="pill" id="folderCount"></span></div><input id="search" class="search" placeholder="جست‌وجوی سند، محموله، بارنامه، کوتاژ…"><div id="tree" class="tree"></div></aside>
<section class="panel"><div class="toolbar"><strong id="currentTitle">همه اسناد</strong><span class="pill" id="fileCount"></span></div><div id="files" class="files"></div><h3 id="detailTitle" hidden>اطلاعات سند و پرونده</h3><pre id="detail" class="detail" hidden></pre><div class="notice">این نمای آفلاین روی همین دستگاه ساخته شده و برای مشاهده به اینترنت یا ورود به سامانه نیاز ندارد. برای دریافت آخرین اطلاعات، همگام‌سازی فایل‌منیجر را دوباره اجرا کنید.</div></section></section></main>
<script>
const DATA = __PAYLOAD__;
const folders=DATA.fileManager?.folders||[], docs=DATA.fileManager?.files||[], tables=DATA.tables||{};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selected='',term='';
const pathOf=f=>String(f.relativePath||'');
function stats(){const rows=[['محموله‌ها',(tables.shipments||[]).length],['صاحبان کالا',(tables.clients||[]).length],['اسناد آرشیو',docs.length],['پوشه‌ها',folders.length]];$('stats').innerHTML=rows.map(([n,v])=>'<div class="stat"><span class="muted">'+esc(n)+'</span><b>'+Number(v).toLocaleString('fa-IR')+'</b></div>').join('');$('folderCount').textContent=folders.length.toLocaleString('fa-IR')+' پوشه';}
function renderTree(){const all=[{relativePath:'',display_name:'همه اسناد'},...folders.filter(f=>pathOf(f)).sort((a,b)=>pathOf(a).localeCompare(pathOf(b),'fa'))];$('tree').innerHTML=all.map(f=>{const p=pathOf(f),depth=p?p.split('/').length:0,count=docs.filter(d=>!p||pathOf(d).startsWith(p+'/')||pathOf(d)===p).length;return '<button class="'+(selected===p?'active':'')+'" style="padding-right:'+(10+depth*15)+'px" data-path="'+esc(p)+'">📁 '+esc(f.display_name||'پوشه')+'<small>'+count.toLocaleString('fa-IR')+' سند</small></button>';}).join('');$('tree').querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=b.dataset.path;renderTree();renderDocs();});}
function matches(d){if(selected&&!pathOf(d).startsWith(selected))return false;if(!term)return true;const hay=[d.original_name,d.document_type,d.relativePath,d.shipment_id,d.client_id,JSON.stringify(d.metadata||{})].join(' ').toLocaleLowerCase();return hay.includes(term.toLocaleLowerCase());}
function renderDocs(){const rows=docs.filter(matches);$('currentTitle').textContent=selected||'همه اسناد';$('fileCount').textContent=rows.length.toLocaleString('fa-IR')+' سند';$('files').innerHTML=rows.slice(0,600).map(d=>'<button class="file" data-id="'+esc(d.id)+'"><strong>📄 '+esc(d.original_name||'سند بدون نام')+'</strong><small>'+esc(d.relativePath||'')+'</small><small>'+esc(d.document_type||'سند')+' · '+Number(d.size_bytes||0).toLocaleString('fa-IR')+' بایت</small></button>').join('')||'<div class="empty">سندی در این بخش پیدا نشد.</div>';$('files').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>showDetail(b.dataset.id));}
function showDetail(id){const d=docs.find(x=>String(x.id)===String(id));if(!d)return;const shipment=(tables.shipments||[]).find(x=>x.id===d.shipment_id)||null;const caseRecord=(tables.cases||[]).find(x=>x.id===shipment?.case_id)||null;const vessel=(tables.vessels||[]).find(x=>x.id===shipment?.vessel_id)||null;const folder=folders.find(f=>f.id===d.folder_id)||null;$('detailTitle').hidden=false;$('detail').hidden=false;$('detailTitle').textContent='اطلاعات سند: '+(d.original_name||'');const related={document:d,folder,client:(tables.clients||[]).find(x=>x.id===d.client_id)||null,shipment,caseRecord,vessel,shippingLine:(tables.shipping_lines||[]).find(x=>x.id===vessel?.shipping_line_id)||null,customsOffice:(tables.customs_offices||[]).find(x=>x.id===(folder?.customs_office_id||shipment?.customs_office_id||caseRecord?.customs_office_id))||null,shipmentCustomsData:(tables.shipment_customs_data||[]).filter(x=>x.shipment_id===d.shipment_id),registrationOrders:(tables.registration_orders||[]).filter(x=>x.case_id===caseRecord?.id),customsDeclarations:(tables.customs_declarations||[]).filter(x=>x.shipment_id===d.shipment_id||x.case_id===caseRecord?.id),customsDocuments:(tables.customs_documents||[]).filter(x=>x.folder_id===d.folder_id||x.shipment_id===d.shipment_id),shipmentDocuments:(tables.shipment_documents||[]).filter(x=>x.folder_id===d.folder_id||x.shipment_id===d.shipment_id),financialTransactions:(tables.financial_transactions||[]).filter(x=>x.case_id===caseRecord?.id||x.source_id===d.shipment_id) };$('detail').textContent=JSON.stringify(related,null,2);}
$('search').addEventListener('input',e=>{term=e.target.value.trim();renderDocs();});stats();renderTree();renderDocs();
</script></body></html>`.replace('__PAYLOAD__', payload);
}