import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { CustomsLogo } from '../components/CustomsLogo';

export const LoginPage: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  
  const { user, needsOnboarding } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect if already authenticated
  useEffect(() => {
    if (user) {
      const from = (location.state as any)?.from?.pathname || '/';
      navigate(needsOnboarding ? '/onboarding' : from, { replace: true });
    }
  }, [user, needsOnboarding, navigate, location]);

  const handleAuditGuest = async () => {
    setError(null);
    setAuditLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError) throw signInError;
      if (!data.user) throw new Error('جلسه مهمان ممیزی ایجاد نشد.');

      const { error: profileError } = await supabase.rpc('create_audit_guest_profile');
      if (profileError) throw profileError;

      await supabase.auth.refreshSession();
      navigate('/operations', { replace: true });
    } catch (err: any) {
      setError(err.message || 'ورود مهمان ممیزی انجام نشد.');
    } finally {
      setAuditLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isLogin) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="future-auth min-h-screen flex items-center justify-center dir-rtl font-sans p-4">
      <div className="future-auth-card w-full max-w-md">
        <div className="text-center mb-8 future-auth-head">
          <div className="flex justify-center mb-5"><CustomsLogo size={64} showWordmark /></div>
          <h1 className="text-2xl font-black mb-2">
            {isLogin ? 'ورود به سیستم' : 'ثبت‌نام در سیستم'}
          </h1>
          <p className="text-sm app-muted">
            نرم‌افزار جامع مدیریت ترخیص و لجستیک گمرکی
          </p>
        </div>

        {error && (
          <div className="future-error text-sm mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">ایمیل</label>
            <input
              type="email"
              required
              disabled={loading}
              className="future-input w-full px-4 py-3 text-left dir-ltr disabled:opacity-60"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">رمز عبور</label>
            <input
              type="password"
              required
              disabled={loading}
              minLength={6}
              className="future-input w-full px-4 py-3 text-left dir-ltr disabled:opacity-60"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="future-submit w-full font-black py-3.5 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              isLogin ? 'ورود' : 'ثبت‌نام'
            )}
          </button>
        </form>

        <div className="mt-6">
          <button
            type="button"
            onClick={handleAuditGuest}
            disabled={loading || auditLoading}
            className="w-full border border-slate-300 rounded-xl py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {auditLoading ? 'در حال ورود به حالت ممیزی…' : 'ورود مهمان ممیزی'}
          </button>
          <p className="text-xs text-center text-slate-500 mt-2">
            دسترسی مشاهده‌ای برای تست و ممیزی سیستم — بدون امکان ویرایش
          </p>
        </div>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError(null);
            }}
            disabled={loading}
            className="future-switch text-sm font-bold disabled:opacity-50"
          >
            {isLogin ? 'حساب کاربری ندارید؟ ثبت‌نام کنید' : 'از قبل حساب دارید؟ وارد شوید'}
          </button>
        </div>
      </div>
    </div>
  );
};
