import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';

import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';

const queryClient = new QueryClient();

function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center flex-col">
      <div className="p-8 text-center text-2xl font-bold bg-white rounded-xl shadow-lg border border-green-100">
        🎉 به نرم افزار گمرک خوش آمدید
      </div>
      <p className="mt-4 text-gray-500">
        فاز ۲ (احراز هویت و امنیت) با موفقیت فعال است.
      </p>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* صفحه لاگین */}
            <Route path="/login" element={<LoginPage />} />

            {/* راه اندازی اولیه سازمان */}
            <Route path="/onboarding" element={<OnboardingPage />} />

            {/* داشبورد اصلی (همان روت / ) */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />

            {/* هر آدرس نامعتبر به داشبورد هدایت شود تا باگ حلقه بی‌نهایت ایجاد نشود */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
