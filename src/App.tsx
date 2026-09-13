import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { MainMenuPage } from './pages/MainMenuPage';
import { ClientRegistryPage } from './pages/ClientRegistryPage';
import { MaritimePage } from './pages/MaritimePage';

const queryClient = new QueryClient();

function App() {
  return <QueryClientProvider client={queryClient}><AuthProvider><BrowserRouter><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/onboarding" element={<OnboardingPage />} />
    <Route path="/" element={<ProtectedRoute><MainMenuPage /></ProtectedRoute>} />
    <Route path="/clients" element={<ProtectedRoute><ClientRegistryPage /></ProtectedRoute>} />
    <Route path="/maritime" element={<ProtectedRoute><MaritimePage /></ProtectedRoute>} />
    <Route path="/operations" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></BrowserRouter></AuthProvider></QueryClientProvider>;
}

export default App;
