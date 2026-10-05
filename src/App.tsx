import React,{lazy,Suspense} from 'react';
import { LoginPage } from './pages/LoginPage';
import { DesktopHomePage } from './pages/DesktopHomePage';
import { BrowserRouter,Routes,Route,Navigate,useSearchParams,useLocation } from 'react-router-dom';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider,UserRole,useAuth } from './context/AuthContext';
import { AppearanceProvider } from './context/AppearanceContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { SettingsPersistenceBridge } from './components/SettingsPersistenceBridge';
let lazyPageCounter=0;
const lazyPage=<T extends React.ComponentType<any>>(loader:()=>Promise<{default:T}>,key=`route-${++lazyPageCounter}`)=>lazy(async()=>{
 try{
  const mod=await loader();
  try{sessionStorage.removeItem('customs-os:chunk-retry:'+key)}catch{}
  return mod;
 }catch(error){
  if(typeof window!=='undefined'){
   const storageKey='customs-os:chunk-retry:'+key;
   try{
    if(!sessionStorage.getItem(storageKey)){
     sessionStorage.setItem(storageKey,'1');
     const url=new URL(window.location.href);
     url.searchParams.set('__chunk_reload',String(Date.now()));
     window.location.replace(url.toString());
     await new Promise<never>(()=>{});
    }
   }catch{}
  }
  throw error;
 }
});
// Critical boot routes are statically imported so a missing lazy chunk can never white-screen login/home.
 
const ClientRegistryPage=lazyPage(()=>import('./pages/ClientRegistryPage').then(m=>({default:m.ClientRegistryPage})));
const ClientDocumentManagerPage=lazyPage(()=>import('./pages/ClientDocumentManagerPage').then(m=>({default:m.ClientDocumentManagerPage})));
const VesselSearchPage=lazyPage(()=>import('./pages/VesselSearchPage').then(m=>({default:m.VesselSearchPage})));
const DeclarationPrintPage=lazyPage(()=>import('./pages/DeclarationPrintPage').then(m=>({default:m.DeclarationPrintPage})));
const DeclarationRegistrationPage=lazyPage(()=>import('./pages/DeclarationRegistrationPage').then(m=>({default:m.DeclarationRegistrationPage})));
const DeclarationOperationsChecklistPage=lazyPage(()=>import('./pages/DeclarationOperationsChecklistPage').then(m=>({default:m.DeclarationOperationsChecklistPage})));
const ShipmentStartPage=lazyPage(()=>import('./pages/ShipmentFirstPage').then(m=>({default:m.ShipmentFirstPage})));
const PreDeclarationPage=lazyPage(()=>import('./pages/PreDeclarationPage').then(m=>({default:m.PreDeclarationPage})));
const PermitRulesPage=lazyPage(()=>import('./pages/PermitRulesPage').then(m=>({default:m.PermitRulesPage})));
const FinancePage=lazyPage(()=>import('./pages/FinancePage').then(m=>({default:m.FinancePage})));
const FinanceShipmentPage=lazyPage(()=>import('./pages/FinanceShipmentPage').then(m=>({default:m.FinanceShipmentPage})));
const PaymentRequestPrintPage=lazyPage(()=>import('./pages/PaymentRequestPrintPage').then(m=>({default:m.PaymentRequestPrintPage})));
const ExitPage=lazyPage(()=>import('./pages/ExitPage').then(m=>({default:m.ExitPage})));
const CaseHistoryPage=lazyPage(()=>import('./pages/CaseHistoryPage').then(m=>({default:m.CaseHistoryPage})));
const CaseStagePage=lazyPage(()=>import('./pages/CaseStagePage').then(m=>({default:m.CaseStagePage})));
const CaseRegistryPage=lazyPage(()=>import('./pages/CaseRegistryPage').then(m=>({default:m.CaseRegistryPage})));
const SettingsEnterprisePage=lazyPage(()=>import('./pages/SettingsEnterprisePage').then(m=>({default:m.SettingsEnterprisePage})));
const AdvancedSettingsPage=lazyPage(()=>import('./pages/AdvancedSettingsPage').then(m=>({default:m.AdvancedSettingsPage})));
const RemindersPage=lazyPage(()=>import('./pages/RemindersPage').then(m=>({default:m.RemindersPage})));
const KnowledgeCenterV2Page=lazyPage(()=>import('./pages/KnowledgeCenterV2Page').then(m=>({default:m.KnowledgeCenterV2Page})));
const CustomsDocumentManagerPage=lazyPage(()=>import('./pages/CustomsDocumentManagerPage').then(m=>({default:m.CustomsDocumentManagerPage})));
const CaseAlertsPage=lazyPage(()=>import('./pages/CaseAlertsPage').then(m=>({default:m.CaseAlertsPage})));
const ControlCenterWithAlertsPage=lazyPage(()=>import('./pages/ControlCenterWithAlertsPage').then(m=>({default:m.ControlCenterWithAlertsPage})));
const EnterpriseERPPage=lazyPage(()=>import('./pages/EnterpriseERPPage').then(m=>({default:m.EnterpriseERPPage})));
const MaritimePage=lazyPage(()=>import('./pages/MaritimePage').then(m=>({default:m.MaritimePage})));
const CustomsAccountingVoucherPage=lazyPage(()=>import('./pages/CustomsAccountingVoucherPage').then(m=>({default:m.CustomsAccountingVoucherPage})));
const CustomsAccountingVoucherPrintPage=lazyPage(()=>import('./pages/CustomsAccountingVoucherPrintPage').then(m=>({default:m.CustomsAccountingVoucherPrintPage})));
const ChatPage=lazyPage(()=>import('./features/chat/ChatPage').then(m=>({default:m.ChatPage})));
const CRMPage=lazyPage(()=>import('./features/crm/CRMPage').then(m=>({default:m.CRMPage})));
const OrgConnectionsPage=lazyPage(()=>import('./pages/OrgConnectionsPage').then(m=>({default:m.OrgConnectionsPage})));
import{PwaLifecycle}from'./features/reminders/PwaLifecycle';

const qc=new QueryClient({defaultOptions:{queries:{staleTime:30000,refetchOnWindowFocus:false,retry:1}}});const operational:UserRole[]=['owner','admin','broker','warehouse','client'];const staff:UserRole[]=['owner','admin','broker','accountant','warehouse'];const management:UserRole[]=['owner','admin','broker'];const finance:UserRole[]=['owner','admin','accountant'];const admins=new Set(['organization','users','roles','integrations','webhooks','storage','backup','audit','advanced']);
function Ops(){const[p]=useSearchParams();const t=p.get('tab'),shipmentId=p.get('shipmentId'),declarationId=p.get('declarationId');if(t==='pre-declaration')return shipmentId?<PreDeclarationPage/>:<Navigate to="/operations" replace/>;if(t==='declaration')return shipmentId?<DeclarationRegistrationPage/>:<Navigate to="/operations" replace/>;if(t==='stage5')return declarationId?<DeclarationOperationsChecklistPage/>:<Navigate to={shipmentId?`/operations?tab=declaration&shipmentId=${encodeURIComponent(shipmentId)}`:'/operations'} replace/>;if(t==='exit')return declarationId?<ExitPage/>:<Navigate to={shipmentId?`/operations?tab=declaration&shipmentId=${encodeURIComponent(shipmentId)}`:'/operations'} replace/>;return <ShipmentStartPage/>}
function LegacyMaritimeRedirect(){return <VesselSearchPage/>}function LegacyDocumentsExtractRedirect(){const[p]=useSearchParams();const q=p.toString();return <Navigate to={`/documents${q?`?${q}`:''}`} replace/>}function LegacyExitRedirect(){const[p]=useSearchParams();const q=p.toString();return <Navigate to={`/operations?tab=exit${q?`&${q}`:''}`} replace/>}function HomeRoute(){const isChatSubdomain=typeof window!=='undefined'&&window.location.hostname.toLowerCase()==='chat.darbandicommercial.ir';return isChatSubdomain?<ProtectedRoute><ChatPage/></ProtectedRoute>:<ProtectedRoute><DesktopHomePage/></ProtectedRoute>}
function Settings(){const{profile}=useAuth();const l=useLocation();const s=l.pathname.replace('/settings','').replace(/^\//,'').split('/')[0];if(s==='advanced'&&profile?.role!=='owner')return <Navigate to="/settings" replace/>;if(s==='advanced')return <AdvancedSettingsPage/>;if(admins.has(s)&&!['owner','admin'].includes(profile?.role||''))return <Navigate to="/settings" replace/>;return <SettingsEnterprisePage/>}
export default function App(){return <><QueryClientProvider client={qc}><AuthProvider><AppearanceProvider><SettingsPersistenceBridge/><BrowserRouter><PwaLifecycle/><AppShell><Suspense fallback={<div dir="rtl" className="min-h-screen grid place-items-center bg-[var(--bg)] text-[var(--text)]"><div className="text-sm font-bold">در حال بارگذاری بخش…</div></div>}><Routes><Route path="/login" element={<LoginPage/>}/><Route path="/" element={<HomeRoute/>}/><Route path="/erp" element={<ProtectedRoute allowedRoles={['owner','admin','accountant','broker']}><EnterpriseERPPage/></ProtectedRoute>}/><Route path="/clients" element={<ProtectedRoute allowedRoles={management}><ClientRegistryPage/></ProtectedRoute>}/><Route path="/client-documents" element={<ProtectedRoute allowedRoles={management}><ClientDocumentManagerPage/></ProtectedRoute>}/><Route path="/cases" element={<ProtectedRoute allowedRoles={operational}><CaseRegistryPage/></ProtectedRoute>}/><Route path="/maritime" element={<ProtectedRoute allowedRoles={management}><MaritimePage/></ProtectedRoute>}/><Route path="/vessel-search" element={<ProtectedRoute allowedRoles={staff}><VesselSearchPage/></ProtectedRoute>}/><Route path="/operations" element={<ProtectedRoute allowedRoles={operational}><Ops/></ProtectedRoute>}/><Route path="/permit-rules" element={<ProtectedRoute allowedRoles={management}><PermitRulesPage/></ProtectedRoute>}/><Route path="/finance/accounting-vouchers/print" element={<ProtectedRoute allowedRoles={['owner','admin','accountant','client']}><CustomsAccountingVoucherPrintPage/></ProtectedRoute>}/><Route path="/finance/accounting-vouchers/:id" element={<ProtectedRoute allowedRoles={['owner','admin','accountant','client']}><CustomsAccountingVoucherPage/></ProtectedRoute>}/><Route path="/finance/accounting-vouchers" element={<ProtectedRoute allowedRoles={['owner','admin','accountant','client']}><CustomsAccountingVoucherPage/></ProtectedRoute>}/><Route path="/finance/shipments/:id" element={<ProtectedRoute allowedRoles={finance}><FinanceShipmentPage/></ProtectedRoute>}/><Route path="/finance/payment-requests/print" element={<ProtectedRoute allowedRoles={finance}><PaymentRequestPrintPage/></ProtectedRoute>}/><Route path="/finance" element={<ProtectedRoute allowedRoles={finance}><FinancePage/></ProtectedRoute>}/><Route path="/exit" element={<ProtectedRoute allowedRoles={['owner','admin','broker','warehouse']}><LegacyExitRedirect/></ProtectedRoute>}/><Route path="/control" element={<ProtectedRoute allowedRoles={management}><ControlCenterWithAlertsPage/></ProtectedRoute>}/><Route path="/case-documents" element={<ProtectedRoute allowedRoles={operational}><Navigate to="/documents" replace/></ProtectedRoute>}/><Route path="/history" element={<ProtectedRoute allowedRoles={staff}><CaseHistoryPage/></ProtectedRoute>}/><Route path="/stage" element={<ProtectedRoute allowedRoles={management}><CaseStagePage/></ProtectedRoute>}/><Route path="/print-declaration" element={<ProtectedRoute allowedRoles={management}><DeclarationPrintPage/></ProtectedRoute>}/><Route path="/documents/extract" element={<ProtectedRoute allowedRoles={operational}><LegacyDocumentsExtractRedirect/></ProtectedRoute>}/><Route path="/documents" element={<ProtectedRoute allowedRoles={operational}><CustomsDocumentManagerPage/></ProtectedRoute>}/><Route path="/knowledge" element={<ProtectedRoute allowedRoles={management}><KnowledgeCenterV2Page/></ProtectedRoute>}/><Route path="/chat" element={<ProtectedRoute><ChatPage/></ProtectedRoute>}/><Route path="/settings/connections" element={<ProtectedRoute allowedRoles={['owner','admin']}><OrgConnectionsPage/></ProtectedRoute>}/><Route path="/crm" element={<ProtectedRoute allowedRoles={management}><CRMPage/></ProtectedRoute>}/><Route path="/reminders/share" element={<ProtectedRoute><RemindersPage/></ProtectedRoute>}/><Route path="/reminders" element={<ProtectedRoute><RemindersPage/></ProtectedRoute>}/><Route path="/alerts" element={<ProtectedRoute allowedRoles={operational}><CaseAlertsPage/></ProtectedRoute>}/><Route path="/settings/advanced" element={<ProtectedRoute allowedRoles={["owner"]}><AdvancedSettingsPage/></ProtectedRoute>}/><Route path="/settings/*" element={<ProtectedRoute><Settings/></ProtectedRoute>}/><Route path="/declaration-print" element={<Navigate to="/print-declaration" replace/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></Suspense></AppShell></BrowserRouter></AppearanceProvider></AuthProvider></QueryClientProvider></>}
