import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceKey);

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({error:"Unauthorized"}), {status:401,headers:{"Content-Type":"application/json"}});
    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: userData } = await supabase.auth.getUser(token);
    if (!userData.user) return new Response(JSON.stringify({error:"Unauthorized"}), {status:401,headers:{"Content-Type":"application/json"}});

    const { data: vessels, error } = await supabase.from("vessels").select("id,name,imo_number,mmsi_number").or("imo_number.not.is.null,mmsi_number.not.is.null").limit(100);
    if (error) throw error;
    const targets = (vessels ?? []).filter((v:any)=>v.imo_number || v.mmsi_number).slice(0,10);
    const updated:any[] = [];
    const failed:any[] = [];

    for (const vessel of targets) {
      const qs = vessel.imo_number ? `imo=${encodeURIComponent(vessel.imo_number)}` : `mmsi=${encodeURIComponent(vessel.mmsi_number)}`;
      try {
        const r = await fetch(`https://www.aisfriends.com/api/vessels/latest-position?${qs}&format=json`, {headers:{"Accept":"application/json"}});
        if (!r.ok) throw new Error(`AIS HTTP ${r.status}`);
        const payload = await r.json();
        const row = Array.isArray(payload) ? payload[0] : (payload?.data ?? payload?.vessel ?? payload);
        const lat = Number(row?.latitude ?? row?.LAT ?? row?.lat);
        const lon = Number(row?.longitude ?? row?.LON ?? row?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("No AIS position returned");
        const speed = Number(row?.speed ?? row?.SPEED);
        const course = Number(row?.course ?? row?.COURSE);
        const mmsi = row?.mmsi ?? row?.MMSI ?? vessel.mmsi_number ?? null;
        const timestamp = row?.timestamp ?? row?.TIMESTAMP ?? new Date().toISOString();
        const patch:any = {last_latitude:lat,last_longitude:lon,last_position_at:new Date(timestamp).toISOString(),last_position_source:"aisfriends"};
        if (Number.isFinite(speed)) patch.last_speed_knots=speed;
        if (Number.isFinite(course)) patch.last_course_deg=course;
        if (mmsi) patch.mmsi_number=String(mmsi);
        const {error:updateError}=await supabase.from("vessels").update(patch).eq("id",vessel.id);
        if(updateError) throw updateError;
        updated.push({id:vessel.id,name:vessel.name,lat,lon});
      } catch (e) { failed.push({id:vessel.id,name:vessel.name,error:String(e)}); }
    }
    return new Response(JSON.stringify({ok:true,provider:"AISFriends",checked:targets.length,updated,failed,generated_at:new Date().toISOString()}),{headers:{"Content-Type":"application/json"}});
  } catch (e) {
    return new Response(JSON.stringify({error:String(e)}),{status:500,headers:{"Content-Type":"application/json"}});
  }
});