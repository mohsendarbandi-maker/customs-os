import { useCallback, useEffect, useMemo, useState } from 'react';
import { Monitor, RefreshCw, ShieldCheck, Smartphone, Tablet, Laptop, LogOut, Clock3 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { describeDevice, getSessionIdFromAccessToken } from '../lib/deviceSessions';
import { isCloudflareStagingHost } from '../lib/recoveryHost';

type AuthSessionRow = {
  session_id: string;
  created_at: string;
  last_active_at: string;
  user_agent: string | null;
  device_label: string | null;
  app_origin: string | null;
  is_current: boolean;
  revoke_requested_at: string | null;
};

const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'نامشخص'
    : new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const DeviceIcon = ({ userAgent, deviceLabel }: { userAgent: string | null; deviceLabel?: string | null }) => {
  const details = (deviceLabel || '') + ' ' + (userAgent || '');
  if (/iPhone|Android/i.test(details)) return <Smartphone size={19}/>;
  if (/iPad|Tablet/i.test(details)) return <Tablet size={19}/>;
  if (/Windows|Macintosh|Mac OS X|Linux|macOS/i.test(details)) return <Laptop size={19}/>;
  return <Monitor size={19}/>;
};

export function SessionManagementPanel() {
  const { user, session } = useAuth();
  const isStaging = isCloudflareStagingHost();
  const currentSessionId = isStaging ? null : getSessionIdFromAccessToken(session?.access_token);
  const [sessions, setSessions] = useState<AuthSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (!user?.id) {
      setSessions([]);
      setLoading(false);
      return;
    }

    setError(null);
    if (isStaging) {
      try {
        const response = await fetch('/api/auth/devices', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        const payload = await response.json().catch(() => ({})) as {
          error?: string;
          sessions?: AuthSessionRow[];
        };
        if (!response.ok) {
          throw new Error(payload.error === 'UNAUTHORIZED'
            ? 'نشست ورود معتبر نیست؛ دوباره وارد شوید.'
            : 'دریافت نشست‌های Cloudflare ناموفق بود: ' + (payload.error || response.status));
        }
        setSessions(Array.isArray(payload.sessions) ? payload.sessions : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'دریافت نشست‌ها ناموفق بود.');
      } finally {
        setLoading(false);
      }
      return;
    }
    const { data, error: loadError } = await supabase.rpc('list_my_auth_sessions');
    if (loadError) {
      setError(loadError.message || 'دریافت نشست‌ها ناموفق بود.');
      setLoading(false);
      return;
    }
    setSessions((Array.isArray(data) ? data : []) as AuthSessionRow[]);
    setLoading(false);
  }, [user?.id, isStaging]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!user?.id || isStaging) return;
    const channel = supabase
      .channel(`session-list-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_device_sessions',
          filter: `user_id=eq.${user.id}`,
        },
        () => void loadSessions(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, loadSessions, isStaging]);

  const otherSessions = useMemo(
    () => sessions.filter((item) => !item.is_current && item.session_id !== currentSessionId),
    [sessions, currentSessionId],
  );

  const revokeOne = async (item: AuthSessionRow) => {
    if (!user?.id || item.session_id === currentSessionId || item.is_current) return;

    setBusyId(item.session_id);
    setError(null);
    setNotice(null);
    try {
      if (isStaging) {
        const response = await fetch('/api/auth/devices/' + encodeURIComponent(item.session_id), {
          method: 'DELETE',
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error('خروج از دستگاه ناموفق بود: ' + (payload.error || response.status));
        setNotice('نشست این دستگاه باطل شد؛ حداکثر در یک دقیقه یا هنگام بازگشت به صفحه از حساب خارج می‌شود.');
        await loadSessions();
        return;
      }
      const { data: existing, error: readError } = await supabase
        .from('user_device_sessions')
        .select('session_id, revoked_at')
        .eq('session_id', item.session_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (readError) throw readError;

      const revokedAt = new Date().toISOString();
      if (existing) {
        if (!existing.revoked_at) {
          const { error: updateError } = await supabase
            .from('user_device_sessions')
            .update({ revoked_at: revokedAt })
            .eq('session_id', item.session_id)
            .eq('user_id', user.id)
            .is('revoked_at', null);
          if (updateError) throw updateError;
        }
      } else {
        const { error: insertError } = await supabase.from('user_device_sessions').insert({
          session_id: item.session_id,
          user_id: user.id,
          device_label: describeDevice(item.user_agent),
          user_agent: item.user_agent,
          app_origin: item.app_origin,
          created_at: item.created_at,
          last_seen_at: item.last_active_at,
          revoked_at: revokedAt,
        });
        if (insertError) throw insertError;
      }

      setNotice('درخواست خروج برای این دستگاه ارسال شد. دستگاه آنلاین فوراً و دستگاه آفلاین هنگام اتصال بعدی خارج می‌شود.');
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خروج از دستگاه ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async () => {
    if (!user?.id || (!isStaging && !currentSessionId) || otherSessions.length === 0) return;

    setBusyAll(true);
    setError(null);
    setNotice(null);
    try {
      if (isStaging) {
        const response = await fetch('/api/auth/devices/revoke-others', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({})) as { error?: string; revoked_count?: number };
        if (!response.ok) throw new Error('خروج از دستگاه‌های دیگر ناموفق بود: ' + (payload.error || response.status));
        setNotice('نشست‌های دیگر باطل شدند. این دستگاه همچنان وارد حساب می‌ماند.');
        await loadSessions();
        return;
      }
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
      if (signOutError) throw signOutError;

      const { error: markError } = await supabase
        .from('user_device_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .neq('session_id', currentSessionId)
        .is('revoked_at', null);

      if (markError) {
        console.warn('[Auth] failed to mark other device sessions after server revocation:', markError);
      }

      setNotice('نشست‌های دیگر از حساب خارج شدند. این دستگاه همچنان وارد حساب می‌ماند.');
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خروج از دستگاه‌های دیگر ناموفق بود.');
    } finally {
      setBusyAll(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-bold text-sm">دستگاه‌های متصل به حساب</div>
          <p className="text-xs app-muted mt-1">ورود هم‌زمان از موبایل، تبلت و چند کامپیوتر مجاز است؛ محدودیت تعداد دستگاه فعال ندارید.</p>
        </div>
        <button
          type="button"
          onClick={() => { setLoading(true); void loadSessions(); }}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border app-border px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>
          به‌روزرسانی
        </button>
      </div>

      {otherSessions.length > 0 && (
        <button
          type="button"
          onClick={() => void revokeOthers()}
          disabled={busyAll || loading}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          <LogOut size={16}/>
          {busyAll ? 'در حال خروج…' : 'خروج از تمام دستگاه‌های دیگر'}
        </button>
      )}

      {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700">{notice}</div>}

      {loading ? (
        <div className="rounded-xl bg-[var(--surface-2)] p-5 text-center text-xs app-muted">در حال دریافت نشست‌ها…</div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl bg-[var(--surface-2)] p-5 text-center text-xs app-muted">نشست فعالی پیدا نشد.</div>
      ) : (
        <div className="space-y-2">
          {sessions.map((item) => {
            const isCurrent = item.is_current || item.session_id === currentSessionId;
            const deviceName = item.device_label || describeDevice(item.user_agent);
            const pending = Boolean(item.revoke_requested_at);
            return (
              <article key={item.session_id} className="rounded-2xl border app-border bg-[var(--surface-2)] p-3 sm:p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--surface)]">
                    <DeviceIcon userAgent={item.user_agent} deviceLabel={item.device_label}/>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-sm">{deviceName}</b>
                      {isCurrent && <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-700">این دستگاه</span>}
                      {pending && !isCurrent && <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-700">در انتظار خروج</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] app-muted">
                      <span className="inline-flex items-center gap-1"><Clock3 size={12}/>آخرین فعالیت: {formatTime(item.last_active_at)}</span>
                      <span>ورود: {formatTime(item.created_at)}</span>
                    </div>
                    {item.app_origin && <div className="mt-1 text-[10px] app-muted" dir="ltr">{item.app_origin}</div>}
                  </div>
                  {!isCurrent && (
                    <button
                      type="button"
                      onClick={() => void revokeOne(item)}
                      disabled={pending || busyAll || busyId === item.session_id}
                      className="shrink-0 rounded-lg border border-red-500/30 px-3 py-2 text-[11px] font-bold text-red-600 disabled:opacity-40"
                    >
                      {busyId === item.session_id ? '…' : pending ? 'در انتظار' : 'خروج'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl bg-[var(--surface-2)] p-3 text-[11px] app-muted">
        <ShieldCheck size={15} className="mt-0.5 shrink-0"/>
        <p>{isStaging ? 'خروج از هر دستگاه با ابطال نشست در D1 انجام می‌شود؛ درخواست‌های بعدی آن دستگاه دیگر پذیرفته نخواهند شد. به‌روزرسانی فهرست به‌صورت دستی انجام می‌شود.' : 'خروج از یک دستگاه، نشست دستگاه‌های دیگر را دست‌نخورده نگه می‌دارد. درخواست خروج تکی از طریق اعلان زنده ارسال می‌شود؛ اگر دستگاه آفلاین باشد، هنگام بازگشت به اینترنت از حساب خارج خواهد شد.'}</p>
      </div>
    </section>
  );
}
