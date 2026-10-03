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
  const [message, setMessage] = useState<string | null>(null);
  
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (isLogin) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;

        if (data.session) {
          navigate('/onboarding', { replace: true });
        } else {
          setMessage('ثبت‌نام انجام شد. در صورت فعال بودن تأیید ایمیل، لینک تأیید برای شما ارسال شده است.');
        }
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
          <div className="future-error text-sm mb-4" role="alert">
            {error}
          </div>
        )}

        {message && (
          <div className="future-success text-sm mb-4" role="status">
            {message}
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
              autoCapitalize="none"
              autoComplete="email"
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
              autoComplete={isLogin ? 'current-password' : 'new-password'}
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

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError(null);
              setMessage(null);
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
