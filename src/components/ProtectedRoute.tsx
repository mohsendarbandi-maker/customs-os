import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, UserRole } from '../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { user, profile, loading, needsOnboarding, error, signOut, refreshProfile } = useAuth();
  const location = useLocation();

  // Gate 1: App is initializing or fetching profile
  if (loading) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex items-center justify-center p-6"
        aria-busy="true"
        aria-label="در حال بارگذاری Customs OS"
      >
        <div className="w-full max-w-xs rounded-2xl border app-border bg-[var(--surface)] p-6 text-center shadow-xl">
          <div className="mx-auto mb-4 h-10 w-10 rounded-full border-4 border-[var(--primary)]/20 border-t-[var(--primary)] animate-spin" />
          <div className="font-bold text-sm">در حال بارگذاری سامانه…</div>
          <div className="text-xs app-muted mt-2">در حال بازیابی نشست و آماده‌سازی اطلاعات شما</div>
        </div>
      </div>
    );
  }

  // Gate 2: User is not logged into Supabase Auth
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Gate 3: Network or Database Error during profile fetch
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dir-rtl font-sans p-4">
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 text-center max-w-sm w-full">
          <h2 className="text-red-600 font-bold text-lg mb-2">خطای اتصال</h2>
          <p className="text-gray-600 text-sm mb-6">{error}</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => refreshProfile()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm py-2.5 rounded-lg font-semibold transition"
            >
              تلاش دوباره
            </button>
            <button
              onClick={() => signOut()}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm py-2.5 rounded-lg transition"
            >
              خروج
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Gate 4: Registered but missing Tenant/Profile records
  if (needsOnboarding && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  // Gate 5: Account disabled by administrator
  if (profile && !profile.is_active) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dir-rtl font-sans p-4">
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-red-100 text-center max-w-sm w-full">
          <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 text-xl">
            ⚠️
          </div>
          <h2 className="text-gray-900 font-bold text-lg mb-2">حساب غیرفعال است</h2>
          <p className="text-gray-500 text-sm mb-6">دسترسی این حساب توسط مدیر غیرفعال شده است.</p>
          <button
            onClick={() => signOut()}
            className="w-full bg-red-600 hover:bg-red-700 text-white text-sm py-2.5 rounded-lg font-semibold transition"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Gate 6: RBAC - Role validation
  if (allowedRoles && allowedRoles.length > 0) {
    if (!profile || !allowedRoles.includes(profile.role)) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dir-rtl font-sans p-4">
          <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 text-center max-w-sm w-full">
            <h2 className="text-gray-900 font-bold text-lg mb-2">دسترسی غیرمجاز</h2>
            <p className="text-gray-500 text-sm mb-6">مجوز لازم برای این بخش را ندارید.</p>
            <button
              onClick={() => window.history.back()}
              className="w-full bg-gray-900 hover:bg-gray-800 text-white text-sm py-2.5 rounded-lg font-semibold transition"
            >
              بازگشت
            </button>
          </div>
        </div>
      );
    }
  }

  // All gates passed
  return <>{children}</>;
};
