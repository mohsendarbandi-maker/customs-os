import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Source={source:string;url:string;ok:boolean;name?:string|null;mmsi?:string|null;imo?:string|null;lat?:number|null;lon?:number|null;positionAt?:string|null;speed?:number|null;course?:number|null;region?:string|null;rawPosition?:string|null;error?:string};

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
const clean=(s:string)=>s.replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const num=(s?:string|null)=>{if(!s)return null;const n=Number(s.replace(/,/g,''));return Number.isFinite(n)?n:null};
const first=(re:RegExp,t:string)=>{const m=t.match(re);return m?.[1]??null};
const fetchText=async(url:string)=>{const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 CustomsOS Vessel Research","Accept":"text/html,application/xhtml+xml"}});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}`);return t};
const parseCoords=(t:string)=>{
  const patterns=[
    /(?:latitude|lat)["'\s:=]+(-?\d{1,3}\.\d{3,})[^\n]{0,180}?(?:longitude|lon)["'\s:=]+(-?\d{1,3}\.\d{3,})/i,
    /(?:longitude|lon)["'\s:=]+(-?\d{1,3}\.\d{3,})[^\n]{0,180}?(?:latitude|lat)["'\s:=]+(-?\d{1,3}\.\d{3,})/i,
    /(-?\d{2}\.\d{4,})\s*[,/]\s*(-?\d{2}\.\d{4,})/
  ];
  for(const p of patterns){const m=t.match(p);if(!m)continue;let a=num(m[1]),b=num(m[2]);if(a==null||b==null)continue;if(Math.abs(a)<=90&&Math.abs(b)<=180)return p===patterns[1]?{lat:b,lon:a}:{lat:a,lon:b};}
  return null;
};
const parseSource=async(source:string,url:string,html:string,imo:string,mmsi:string|null):Promise<Source>=>{
  const text=clean(html);
  const c=parseCoords(html);
  const name=first(/(?:<title[^>]*>\s*)?([^<]{2,60}?)\s*(?:,\s*(?:General Cargo|Dry bulk|Reserved for future use)|\s*-\s*Details)/i,html) || first(/(?:vesselName|SHIPNAME|shipname)["'\s:=]+["']([^"']+)/i,html);
  const foundMmsi=first(/(?:MMSI|mmsi)[^0-9]{0,30}(\d{9})/i,text) || mmsi;
  const speed=first(/(?:Speed|speed)[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(?:Knots|kn|knot)/i,text);
  const course=first(/(?:Course|course)[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(?:º|°|deg)/i,text);
  const positionAt=first(/(?:Position received|Position Received|Last Position Update|last update)[^0-9]{0,40}((?:20\d\d[-/]\d\d[-/]\d\d[^|<]{0,25})|(?:\d+\s+(?:hours?|days?|minutes?)\s+ago))/i,text);
  let region:string|null=null;for(const r of [/current position[^.]{0,120}\b(in|at)\s+([^.;]{3,80})/i,/currently in the\s+([^,.;]{3,80})/i,/position[^.]{0,100}\b(Caspian Sea|Russian 12 NM|Caspian)/i]){const m=text.match(r);if(m){region=m[m.length-1].trim();break}}
  return {source,url,ok:true,name:name?clean(name):null,imo,mmsi:foundMmsi,lat:c?.lat??null,lon:c?.lon??null,positionAt:positionAt?clean(positionAt):null,speed:num(speed),course:num(course),region,rawPosition:c?`${c.lat}, ${c.lon}`:null};
};

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const body=await req.json().catch(()=>({}));
    const imo=String(body?.imo||'').replace(/\D/g,'');
    if(!/^\d{7}$/.test(imo))return new Response(JSON.stringify({error:'IMO باید ۷ رقم باشد'}),{status:400,headers:cors});
    const vfUrl=`https://www.vesselfinder.com/vessels/details/${imo}`;
    let vfHtml='';try{vfHtml=await fetchText(vfUrl)}catch{}
    const vfText=clean(vfHtml);
    const mmsi=first(/(?:IMO\s*\/?\s*MMSI|IMO\s*\/\s*MMSI)[^0-9]{0,20}${imo}\s*\/\s*(\d{9})/i,vfText)||first(/MMSI[^0-9]{0,20}(\d{9})/i,vfText);
    const name=first(/<h1[^>]*>\s*([^<]+)\s*<\/h1>/i,vfHtml)||first(/#\s*([^\n]{2,60})/i,vfText);
    const slug=(name||'').trim().replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
    const sources:{source:string;url:string}[]=[
      {source:'VesselFinder',url:vfUrl},
      {source:'MyShipTracking',url:`https://www.myshiptracking.com/vessels/${slug}-mmsi-${mmsi||'unknown'}-imo-${imo}`},
      {source:'Maritime Optima',url:`https://maritimeoptima.com/public/vessels/pages/imo%3A${imo}${mmsi?`/mmsi%3A${mmsi}`:''}/${slug.toUpperCase()||'VESSEL'}.html`},
      {source:'MagicPort',url:`https://magicport.ai/vessels/general-cargo/${slug}-mmsi-${mmsi||'unknown'}`}
    ];
    const results:Source[]=[];
    await Promise.all(sources.map(async s=>{try{const h=s.source==='VesselFinder'?vfHtml:await fetchText(s.url);results.push(await parseSource(s.source,s.url,h,imo,mmsi));}catch(e){results.push({source:s.source,url:s.url,ok:false,error:String(e?.message||e),imo,mmsi});}}));
    const withCoords=results.filter(x=>x.ok&&x.lat!=null&&x.lon!=null) as (Source&{lat:number;lon:number})[];
    let selected:any=null;
    if(withCoords.length){
      const sorted=[...withCoords].sort((a,b)=>new Date(b.positionAt||0).getTime()-new Date(a.positionAt||0).getTime());
      const ref=sorted[0];
      const close=withCoords.filter(x=>Math.abs(x.lat-ref.lat)<0.8&&Math.abs(x.lon-ref.lon)<1.2);
      const pool=close.length?close:withCoords;
      selected={lat:pool.reduce((a,x)=>a+x.lat,0)/pool.length,lon:pool.reduce((a,x)=>a+x.lon,0)/pool.length,sourceCount:pool.length,sourceNames:pool.map(x=>x.source),confidence:pool.length>=2?'cross-source':'single-source'};
    }
    return new Response(JSON.stringify({imo,mmsi,name:name?.trim()||null,sources:results.sort((a,b)=>a.source.localeCompare(b.source)),selected,checkedAt:new Date().toISOString()}),{headers:cors});
  }catch(e){return new Response(JSON.stringify({error:String(e?.message||e)}),{status:500,headers:cors});}
});
