import {describe,expect,it} from 'vitest';
import {alertCounts,buildCaseAlerts} from '../src/lib/caseAlerts';

describe('case alert engine',()=>{
 const base={id:'case-1',case_number:'CASE-1',status:'documents_ready',valuation_status:null,release_status:'pending'};
 it('warns when required base documents are not approved',()=>{
  const alerts=buildCaseAlerts([base],[
   {case_id:'case-1',document_type:'PROFORMA_INVOICE',status:'approved'},
   {case_id:'case-1',document_type:'COMMERCIAL_INVOICE',status:'approved'}
  ],[],[]);
  expect(alerts.some(a=>a.id==='case-1-docs')).toBe(true);
  expect(alertCounts(alerts).warning).toBeGreaterThan(0);
 });
 it('removes the base-document alert when all five are approved',()=>{
  const types=['PROFORMA_INVOICE','COMMERCIAL_INVOICE','PACKING_LIST','BILL_OF_LADING','CERTIFICATE_OF_ORIGIN'];
  const docs=types.map(document_type=>({case_id:'case-1',document_type,status:'approved'}));
  const alerts=buildCaseAlerts([{...base,status:'documents_ready'}],docs,[],[]);
  expect(alerts.some(a=>a.id==='case-1-docs')).toBe(false);
 });
 it('raises kottaj, valuation, release and permit alerts at the correct stages',()=>{
  const cases=[
   {...base,id:'c2',case_number:'CASE-2',status:'epl_submitted'},
   {...base,id:'c3',case_number:'CASE-3',status:'valuation',valuation_status:'pending'},
   {...base,id:'c4',case_number:'CASE-4',status:'exit_permit',release_status:'pending'},
  ];
  const alerts=buildCaseAlerts(cases,[],[],[{case_id:'c4',status:'pending'}]);
  expect(alerts.some(a=>a.id==='c2-kottaj')).toBe(true);
  expect(alerts.some(a=>a.id==='c3-valuation')).toBe(true);
  expect(alerts.some(a=>a.id==='c4-release')).toBe(true);
  expect(alerts.some(a=>a.id==='c4-permits')).toBe(true);
 });
});
