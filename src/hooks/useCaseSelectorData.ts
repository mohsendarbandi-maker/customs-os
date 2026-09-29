import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';
import {formatCaseDisplayName} from '../lib/shared/case-display';

export type CaseSelectorClient={id:string;name:string;national_id?:string|null};
export type CaseSelectorRow={
  id:string;
  case_id:string|null;
  client_id:string|null;
  vessel_id:string|null;
  created_at:string;
  updated_at:string;
  case_created_at:string|null;
  display_name:string;
  client_name:string|null;
  vessel_name:string|null;
  cargo_count:number|string|null;
  cargo_count_unit:string|null;
  net_weight_kg:number|string|null;
  gross_weight_kg:number|string|null;
  cargo_description:string|null;
  warehouse_receipt_date:string|null;
  initial_warehousing_invoice_confirmed_at:string|null;
  current_status:string|null;
  transport_documents_status:string|null;
  release_invoice_payment_status:string|null;
  finance_status:string|null;
  bill_of_lading_no:string|null;
};

export const useCaseSelectorData=(organizationId?:string)=>{
  const [clients,setClients]=useState<CaseSelectorClient[]>([]);
  const [vessels,setVessels]=useState<any[]>([]);
  const [rows,setRows]=useState<CaseSelectorRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  useEffect(()=>{
    let cancelled=false;
    if(!organizationId){setLoading(false);return;}
    (async()=>{
      setLoading(true);setError('');
      try{
        const [{data:cl,error:ce},{data:sh,error:se},{data:vs,error:ve},{data:cs,error:caseError}]=await Promise.all([
          supabase.from('clients').select('id,name,national_id').eq('organization_id',organizationId).order('name'),
          supabase.from('shipments').select('id,case_id,client_id,vessel_id,bill_of_lading_no,cargo_count,cargo_count_unit,net_weight_kg,gross_weight_kg,display_name,current_status,transport_documents_status,release_invoice_payment_status,finance_status,created_at,updated_at').eq('organization_id',organizationId).order('created_at',{ascending:false}),
          supabase.from('vessels').select('id,name,imo_number,flag_code,shipping_line_id').eq('organization_id',organizationId).order('name'),
          supabase.from('cases').select('id,client_id,created_at,cargo_description,warehouse_receipt_date,initial_warehousing_invoice_confirmed_at').eq('organization_id',organizationId).order('created_at',{ascending:false})
        ]);
        if(ce||se||ve||caseError)throw ce||se||ve||caseError;
        if(cancelled)return;
        const clientMap=new Map((cl||[]).map((x:any)=>[x.id,x.name]));
        const vesselMap=new Map((vs||[]).map((x:any)=>[x.id,x.name]));
        const caseMap=new Map((cs||[]).map((x:any)=>[x.id,x]));
        const mapped=(sh||[]).map((x:any)=>{
          const c=caseMap.get(x.case_id);
          const clientId=x.client_id??c?.client_id??null;
          const clientName=clientMap.get(clientId)||null;
          const vesselName=vesselMap.get(x.vessel_id)||null;
          return {
            ...x,
            client_id:clientId,
            case_created_at:c?.created_at||null,
            client_name:clientName,
            vessel_name:vesselName,
            cargo_description:c?.cargo_description||null,
            warehouse_receipt_date:c?.warehouse_receipt_date||null,
            initial_warehousing_invoice_confirmed_at:c?.initial_warehousing_invoice_confirmed_at||null,
            display_name:formatCaseDisplayName({
              cargo_count:x.cargo_count,
              cargo_count_unit:x.cargo_count_unit,
              client_name:clientName,
              vessel_name:vesselName
            })
          } as CaseSelectorRow;
        }).sort((a,b)=>{
          const ad=a.case_created_at||a.created_at;
          const bd=b.case_created_at||b.created_at;
          return String(bd).localeCompare(String(ad));
        });
        setClients((cl||[]) as CaseSelectorClient[]);
        setVessels(vs||[]);
        setRows(mapped);
      }catch(e:any){
        if(!cancelled)setError(e?.message||'دریافت صاحبان کالا و پرونده‌ها انجام نشد');
      }finally{
        if(!cancelled)setLoading(false);
      }
    })();
    return()=>{cancelled=true};
  },[organizationId]);

  return {clients,vessels,rows,loading,error};
};
