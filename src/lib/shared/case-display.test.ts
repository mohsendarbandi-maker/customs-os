import {describe,expect,it} from 'vitest';
import {formatCaseDisplayName} from './case-display';

describe('formatCaseDisplayName',()=>{
 it('matches the /cases display contract',()=>{
  expect(formatCaseDisplayName({
   cargo_count:22,
   cargo_count_unit:'رول',
   client_name:'آبتین تجارت فولاد ونداد',
   vessel_name:'KASPIYSKIY BEREG'
  })).toBe('۲۲ رول آبتین تجارت فولاد ونداد KASPIYSKIY BEREG');
 });
});
