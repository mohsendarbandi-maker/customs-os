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
    <div className="future-auth min-h-screen flex items-center justify-center dir-rtl font-sans p-4">
      <div className="future-auth-card w-full max-w-md">
        <div className="text-center mb-8">
          <div className="future-orb mx-auto mb-5">
            🏢
          </div>
          <h1 className="text-2xl font-black mb-2">راه‌اندازی سازمان</h1>
          <p className="app-muted text-sm">
            برای شروع کار با سیستم، نام خود و شرکت ترخیص‌کاری را وارد کنید.
          </p>
        </div>

        {error && (
          <div className="future-error text-sm mb-6">
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
              className="future-input w-full px-4 py-3"
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
              className="future-input w-full px-4 py-3"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="مثال: شرکت ترخیص‌کاری تجارت‌گستر"
            />
            <p className="text-xs app-muted mt-2">
              شما به عنوان مدیر کل (Owner) این سازمان ثبت خواهید شد.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="future-submit w-full font-black py-3.5 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center mt-2"
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
