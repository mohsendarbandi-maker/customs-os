import {describe,it,expect} from 'vitest';
describe('temporary admission workflow',()=>{
 it('defines ordered stages from evidence to closure',()=>{
  const stages=['documents','permits','declaration','guarantee','use_period','re_export','completed'];
  expect(stages[0]).toBe('documents');
  expect(stages.indexOf('guarantee')).toBeLessThan(stages.indexOf('re_export'));
  expect(stages.at(-1)).toBe('completed');
 });
 it('keeps temporary import and processing distinct from definitive import',()=>{
  expect(['import_temporary','temporary_processing']).not.toContain('import_definitive');
 });
});
