import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');
describe('mobile command center and shared floating dock',()=>{
 const home=read('src/pages/DesktopHomePage.tsx'),dashboard=read('src/components/MobileCommandDashboard.tsx');
 const tracker=read('src/components/LatestShipmentStatuses.tsx'),showcase=read('src/pages/ShipmentShowcasePage.tsx');
 const dock=read('src/styles/mobile-native-unified-2026.css'),screens=read('src/styles/mobile-native-screens-2026.css');
 const chat=read('src/styles/mobile-native-chat-viewport-fix-2026.css');
 const canonical=read('src/styles/mobile-bottom-anchored-shell-2026.css');
 it('uses live metrics and existing operational widgets',()=>{
  expect(home).toContain('if(isMobileDashboard)');
  expect(home).toContain('stats={stats}');
  expect(home).toContain('shipmentTracker={<LatestShipmentStatuses/>}');
  expect(home).toContain('reminders={<RemindersHomeCard/>}');
  expect(home).toContain('setInterval(()=>setNow(new Date()),60_000)');
  expect(dashboard).toContain('stats.active.toLocaleString');
  expect(dashboard).toContain("{key:'activeCases'");
  expect(dashboard).toContain('stats[key].toLocaleString');
 });
 it('connects quick access and settings to established routes',()=>{
  expect(dashboard).toContain('to="/settings"');
  expect(dashboard).not.toContain('/settings/appearance');
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
 it('reserves the actual iPhone safe area for one edge-to-edge dock',()=>{
  expect(dock).not.toContain('.app-mobile-dock');
  expect(canonical).toContain('--cos-tab-height: 52px;');
  expect(canonical).toContain('--cos-tab-safe-area: env(safe-area-inset-bottom, 0px);');
  expect(canonical).toContain('--cos-tab-reserve: calc(var(--cos-tab-height) + var(--cos-tab-safe-area));');
  expect(canonical).toContain('left: 0;');expect(canonical).toContain('right: 0;');expect(canonical).toContain('bottom: 0;');expect(canonical).toContain('width: 100%;');
  expect(canonical).toContain('padding: 0 6px var(--cos-tab-safe-area);');
  expect(canonical).toContain('padding-bottom: var(--cos-tab-reserve) !important;');
 });
 it('uses the same dock geometry and keyboard offset on the chat route',()=>{
  expect(chat).not.toContain('.app-mobile-dock');
  expect(canonical).toContain('.app-shell.is-touch-layout.is-chat-route .app-content.is-chat-content');
  expect(canonical).toContain('bottom: var(--mobile-keyboard-bottom-inset, 0px);');
  expect(canonical).not.toContain('--chat-visual-bottom-inset');
 });
 it('contains long mixed-direction labels on compact screens',()=>{
  expect(screens).toContain('unicode-bidi:plaintext');expect(screens).toContain('@media(max-width:359px)');
 });
});
