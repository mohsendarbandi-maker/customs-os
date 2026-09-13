import React from 'react';
import {BrowserRouter,Routes,Route,Navigate} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from './context/AuthContext';
import {AppearanceProvider} from './context/AppearanceContext';
import {ProtectedRoute} from './components/ProtectedRoute';
import {AppShell} from './components/AppShell';
import {LoginPage} from './pages/LoginPage';
import {OnboardingPage} from './pages/OnboardingPage';
import {MainMenuPage} from './pages/MainMenuPage';
import {ClientRegistryPage} from './pages/ClientRegistryPage';
import {MaritimePage} from './pages/MaritimePage';
import {DeclarationPrintPage} from './pages/DeclarationPrintPage';
import {OperationsPage} from './pages/OperationsPage';
import {PermitRulesPage} from './pages/PermitRulesPage';
import {FinancePage} from './pages/FinancePage';
import {ExitPage} from './pages/ExitPage';
import {ControlCenterPage} from './pages/ControlCenterPage';
import {CaseHistoryPage} from './pages/CaseHistoryPage';
import {CaseStagePage} from './pages/CaseStagePage';

const queryClient=new QueryClient({defaultOptions:{queries:{staleTime:30_000,refetchOnWindowFocus:false,retry:1}}});

function App(){return <QueryClientProvider client={queryClient}><AuthProvider><AppearanceProvider><BrowserRouter><AppShell><Routes><Route path="/login" element={<LoginPage/>}/><Route path="/onboarding" element={<OnboardingPage/>}/><Route path="/" element={<ProtectedRoute><MainMenuPage/></ProtectedRoute>}/><Route path="/clients" element={<ProtectedRoute><ClientRegistryPage/></ProtectedRoute>}/><Route path="/maritime" element={<ProtectedRoute><MaritimePage/></ProtectedRoute>}/><Route path="/operations" element={<ProtectedRoute><OperationsPage/></ProtectedRoute>}/><Route path="/permit-rules" element={<ProtectedRoute><PermitRulesPage/></ProtectedRoute>}/><Route path="/finance" element={<ProtectedRoute><FinancePage/></ProtectedRoute>}/><Route path="/exit" element={<ProtectedRoute><ExitPage/></ProtectedRoute>}/><Route path="/control" element={<ProtectedRoute><ControlCenterPage/></ProtectedRoute>}/><Route path="/history" element={<ProtectedRoute><CaseHistoryPage/></ProtectedRoute>}/><Route path="/stage" element={<ProtectedRoute><CaseStagePage/></ProtectedRoute>}/><Route path="/print-declaration" element={<ProtectedRoute><DeclarationPrintPage/></ProtectedRoute>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></AppShell></BrowserRouter></AppearanceProvider></AuthProvider></QueryClientProvider>};
export default App;
