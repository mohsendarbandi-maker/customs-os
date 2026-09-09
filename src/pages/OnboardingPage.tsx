import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export const OnboardingPage: React.FC = () => {
  const { user, needsOnboarding, refreshProfile } = useAuth();
  const navigate = useNavigate();
  
  const [fullName, setFullName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Security guard: Only allow access if user is logged in but missing a profile
  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true });
    } else if (!needsOnboarding) {
      navigate('/', { replace: true });
    }
  }, [user, needsOnboarding, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !orgName.trim()) return;

    setError(null);
    setLoading(true);

    try {
      // Call the secure RPC function defined in Phase 1 database schema
      const { error: rpcError } = await supabase.rpc('create_tenant_account', {
        org_name: orgName.trim(),
        user_full_name: fullName.trim(),
      });

      if (rpcError) throw rpcError;

      // Force AuthContext to re-fetch the newly created profile
      await refreshProfile();
      
      // Navigate to dashboard
      navigate('/', { replace: true });
    } catch (err: any) {
      console.error('Onboarding Error:', err);
      setError(err.message || 'خطا در ایجاد سازمان. لطفا مجددا تلاش کنید.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dir-rtl font-sans p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
            🏢
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">راه‌اندازی سازمان</h1>
          <p className="text-gray-500 text-sm">
            برای شروع کار با سیستم، نام خود و شرکت ترخیص‌کاری را وارد کنید.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-6 border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">نام و نام خانوادگی شما</label>
            <input
              type="text"
              required
              minLength={2}
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="مثال: محمد موسوی"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">نام شرکت / سازمان</label>
            <input
              type="text"
              required
              minLength={2}
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="مثال: شرکت ترخیص‌کاری تجارت‌گستر"
            />
            <p className="text-xs text-gray-400 mt-2">
              شما به عنوان مدیر کل (Owner) این سازمان ثبت خواهید شد.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center mt-2"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              'ایجاد حساب سازمانی'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
