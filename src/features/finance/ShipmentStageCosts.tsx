import React,{useEffect,useState}from'react';
import{useAuth}from'../../context/AuthContext';
import{supabase}from'../../lib/supabase';
import{ShipmentCostsPanel}from'./ShipmentCostsPanel';
import type{ShipmentCostStage}from'./shipmentCosts';

type Props={stage:ShipmentCostStage;shipmentId?:string;shipment?:any};

export const ShipmentStageCosts:React.FC<Props>=({stage,shipmentId,shipment})=>{
 const{profile}=useAuth();
 const[resolved,setResolved]=useState<any>(shipment||null);
 const[loading,setLoading]=useState(!shipment);
 const[error,setError]=useState('');
 useEffect(()=>{
  if(shipment?.id){setResolved(shipment);setLoading(false);return}
  if(!shipmentId||!profile?.organization_id){setResolved(null);setLoading(false);return}
  let active=true;
  setLoading(true);setError('');
  void supabase.from('shipments')
   .select('id,organization_id,client_id,case_id,display_name,bill_of_lading_no')
   .eq('id',shipmentId).eq('organization_id',profile.organization_id).maybeSingle()
   .then(({data,error:e})=>{
    if(!active)return;
    if(e){setError(e.message);setResolved(null)}else{setResolved(data);setError('')}
    setLoading(false);
   });
  return()=>{active=false};
 },[shipment?.id,shipmentId,profile?.organization_id]);
 if(!profile||(!shipmentId&&!shipment))return null;
 if(loading)return <section className="app-surface border app-border rounded-2xl p-4"><div className="text-xs app-muted">در حال بارگذاری هزینه‌های مرحله…</div></section>;
 if(error)return <section className="app-surface border border-red-500/30 rounded-2xl p-4"><div className="text-xs text-red-700">{error}</div></section>;
 if(!resolved)return null;
 return <ShipmentCostsPanel shipment={resolved} profile={profile} fixedStage={stage} onChanged={async()=>{}}/>;
};
