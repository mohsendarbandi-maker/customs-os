import {describe,expect,it} from 'vitest';
import {isoToJalali,jalaliToIso} from './jalali';

describe('Jalali conversion',()=>{
 it('round-trips known dates',()=>{
  expect(isoToJalali('2026-09-29')).toBe('1405/07/07');
  expect(jalaliToIso('1405/07/07')).toBe('2026-09-29');
  expect(jalaliToIso('۱۴۰۵/۰۷/۰۷')).toBe('2026-09-29');
 });
});
