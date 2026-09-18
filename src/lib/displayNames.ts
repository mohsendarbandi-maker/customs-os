export type ShipmentNamingInput={cargo_count?:number|null;cargo_count_unit?:string|null;client_name?:string|null;vessel_name?:string|null};
export const buildShipmentDisplayName=(x:ShipmentNamingInput)=>[x.cargo_count!=null?new Intl.NumberFormat('fa-IR').format(Number(x.cargo_count)):null,x.cargo_count_unit?.trim(),x.client_name?.trim(),x.vessel_name?.trim()].filter(Boolean).join(' ')||'محموله بدون نام';
export const buildCaseDisplayName=buildShipmentDisplayName;
