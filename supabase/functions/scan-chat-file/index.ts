// Deployed Edge Function: scan-chat-file. Chat attachment scanning is disabled by application configuration.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "jsr:@supabase/supabase-js@2";

const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  try {
    const {data:expected,error}=await admin.rpc("internal_get_reminder_secret",{p_name:"file_scan_cron_secret"});
    if(error||!expected||req.headers.get("x-file-scan-cron-secret")!==expected)return json({error:"unauthorized"},401);
    return json({ok:true,enabled:false,processed:0,message:"Chat attachment scanning is disabled."});
  } catch {
    return json({ok:false,enabled:false,error:"disabled"},200);
  }
});
