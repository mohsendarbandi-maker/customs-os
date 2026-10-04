import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { CustomsLogo } from '../components/CustomsLogo';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, needsOnboarding, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!user) return;

    if (needsOnboarding) {
      void signOut();
      return;
    }

    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';
    navigate(from, { replace: true });
  }, [user, needsOnboarding, navigate, location, signOut]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) throw signInError;
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'ورود ناموفق بود. اطلاعات ورود را بررسی کنید.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="future-auth min-h-screen flex items-center justify-center dir-rtl font-sans p-4">
      <div className="future-auth-card w-full max-w-md">
        <div className="text-center mb-8 future-auth-head">
          <div className="flex justify-center mb-5">
            <CustomsLogo size={64} showWordmark />
          </div>
          <h1 className="text-2xl font-black mb-2">ورود به سیستم</h1>
          <p className="text-sm app-muted">
            نرم‌افزار جامع مدیریت ترخیص و لجستیک گمرکی
          </p>
        </div>

        {error && (
          <div className="future-error text-sm mb-4" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              ایمیل
            </label>
            <input
              type="email"
              required
              disabled={loading}
              className="future-input w-full px-4 py-3 text-left dir-ltr disabled:opacity-60"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoCapitalize="none"
              autoComplete="email"
              placeholder="name@company.com"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              رمز عبور
            </label>
            <input
              type="password"
              required
              disabled={loading}
              className="future-input w-full px-4 py-3 text-left dir-ltr disabled:opacity-60"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="future-submit w-full font-black py-3.5 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              'ورود'
            )}
          </button>
        </form>

      </div>
    </div>
  );
};
