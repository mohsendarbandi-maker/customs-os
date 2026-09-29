import {formatCaseDisplayName} from './shared/case-display';

export type ShipmentNamingInput={
  cargo_count?:number|null;
  cargo_count_unit?:string|null;
  client_name?:string|null;
  vessel_name?:string|null;
};

export const buildShipmentDisplayName=(x:ShipmentNamingInput)=>formatCaseDisplayName(x);
export const buildCaseDisplayName=buildShipmentDisplayName;
