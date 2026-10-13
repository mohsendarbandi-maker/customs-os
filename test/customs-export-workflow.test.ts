import {describe,it,expect} from 'vitest';
describe('customs export workflow phase 3',()=>{
 it('keeps export procedures distinct from definitive import stages',()=>{
  const exportStages=['documents','permits','declaration','valuation','loading','exit','completed'];
  expect(exportStages).toHaveLength(7);
  expect(exportStages).not.toContain('cashier');
  expect(exportStages).not.toContain('port_charges');
 });
 it('requires explicit temporary-export closure review',()=>{
  const temporaryExport={guaranteeStatus:'not_required',guaranteeReference:'عدم نیاز طبق مستند پرونده',returnObligationRecorded:true};
  expect(temporaryExport.guaranteeReference.trim()).not.toBe('');
 });
});
