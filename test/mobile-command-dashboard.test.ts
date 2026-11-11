import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');
describe('mobile command center and shared floating dock',()=>{
 const home=read('src/pages/DesktopHomePage.tsx'),dashboard=read('src/components/MobileCommandDashboard.tsx');
 const tracker=read('src/components/LatestShipmentStatuses.tsx'),showcase=read('src/pages/ShipmentShowcasePage.tsx');
 const dock=read('src/styles/mobile-native-unified-2026.css'),screens=read('src/styles/mobile-native-screens-2026.css');
 const chat=read('src/styles/mobile-native-chat-viewport-fix-2026.css');
 it('uses live metrics and existing operational widgets',()=>{
  expect(home).toContain('if(isMobileDashboard)');
  expect(home).toContain('stats={stats}');
  expect(home).toContain('shipmentTracker={<LatestShipmentStatuses/>}');
  expect(home).toContain('reminders={<RemindersHomeCard/>}');
  expect(dashboard).toContain('stats.active.toLocaleString');
  expect(dashboard).toContain("{key:'activeCases'");
  expect(dashboard).toContain('stats[key].toLocaleString');
 });
 it('connects quick access to established routes',()=>{
  for(const route of ['/operations?tab=pre-declaration','/registration-orders','/file-manager','/finance','/shipment-showcase','/reminders'])expect(dashboard).toContain(route);
 });
 it('does not mark the final stage complete without confirmed exit data',()=>{
  for(const name of ['ثبت محموله','اسناد حمل و قبض انبار','اظهار و دریافت کوتاژ','کنترل و عملیات گمرکی','امور مالی و خروج کالا'])expect(tracker).toContain(name);
  expect(tracker).toContain("return 'active';");expect(tracker).toContain('data-progress-current={current}');expect(tracker).toContain('--shipment-progress');
 });
 it('limits phone card rendering to a useful batch',()=>{
  expect(showcase).toContain('setPageSize(deviceWidth < 650 ? 8 : deviceWidth < 1100 ? 4 : 6);');
  expect(showcase).not.toContain('deviceWidth < 650 ? 500');
 });
 it('reserves safe-area-aware space using a shared floating dock token',()=>{
  expect(dock).toContain('--cos-tab-reserve:calc(var(--cos-tab-height) + var(--cos-tab-inset) + var(--cos-tab-clearance) + env(safe-area-inset-bottom))');
  expect(dock).toContain('inset-inline:var(--cos-tab-inset)!important');expect(dock).toContain('padding:12px 12px var(--cos-tab-reserve)!important');
  expect(screens).toContain('padding-bottom: var(--cos-tab-reserve) !important');
 });
 it('keeps chat floating dock aligned with visual viewport and keyboard',()=>{
  expect(chat).toContain('padding: 0 0 var(--cos-tab-reserve) !important');
  expect(chat).toContain('inset-inline:var(--cos-tab-inset)!important');
  expect(chat).toContain('var(--chat-visual-bottom-inset,0px) + var(--cos-tab-inset)');
 });
 it('contains long mixed-direction labels on compact screens',()=>{
  expect(screens).toContain('unicode-bidi:plaintext');expect(screens).toContain('@media(max-width:359px)');
 });
});
