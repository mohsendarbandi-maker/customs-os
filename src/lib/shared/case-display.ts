export type CaseDisplayInput={cargo_count?:number|string|null;cargo_count_unit?:string|null;client_name?:string|null;vessel_name?:string|null};

const faDigits=(value:string)=>value.replace(/[0-9]/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const clean=(value:unknown)=>String(value??'').replace(/\s+/g,' ').trim();

export const formatCaseDisplayName=(x:CaseDisplayInput)=>{
  const parts=[
    x.cargo_count==null||clean(x.cargo_count)===''?'':faDigits(clean(x.cargo_count)),
    clean(x.cargo_count_unit),
    clean(x.client_name),
    clean(x.vessel_name),
  ].filter(Boolean);
  return parts.join(' ')||'محموله بدون عنوان';
};
