import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* مسیر عمومی لاگین */}
            <Route path="/login" element={<LoginPage />} />
            
            {/* مسیر راه‌اندازی سازمان (فقط برای کاربرانی که تازه ثبت‌نام کرده‌اند) */}
            <Route path="/onboarding" element={<OnboardingPage />} />

            {/* داشبورد اصلی (مسیر محافظت‌شده) */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <div className="min-h-screen bg-gray-50 text-gray-900 dir-rtl font-sans flex items-center justify-center flex-col">
                    <div className="p-8 text-center text-2xl font-bold bg-white rounded-xl shadow-lg border border-green-100">
                      🎉 به نرم‌افزار گمرک خوش آمدید
                    </div>
                    <p className="mt-4 text-gray-500">
                      فاز ۲ (احراز هویت و امنیت) با موفقیت به پایان رسید.
                    </p>
                  </div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
