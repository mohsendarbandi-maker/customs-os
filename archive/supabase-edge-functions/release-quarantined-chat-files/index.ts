// Temporary release helper decommissioned after existing quarantined files were released.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve((req:Request)=>{
  if(req.method!=="POST")return new Response(JSON.stringify({error:"method_not_allowed"}),{status:405,headers:{"content-type":"application/json"}});
  return new Response(JSON.stringify({ok:false,enabled:false,message:"This one-time maintenance endpoint is disabled."}),{status:410,headers:{"content-type":"application/json"}});
});
