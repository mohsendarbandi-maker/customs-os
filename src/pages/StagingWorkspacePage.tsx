import React from 'react';
import { Link } from 'react-router-dom';
import { FileStack, Folder, FileText, BookOpen, Ship, MessageCircle, ClipboardList, Settings, RefreshCw, ShieldCheck, Database } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const tools = [
  { to: '/pdf-studio', title: 'PDF Studio', description: 'بازکردن و پردازش اسناد PDF در مرورگر', icon: FileStack },
  { to: '/file-manager', title: 'مدیریت فایل', description: 'ورود به محیط مدیریت اسناد', icon: Folder },
  { to: '/documents', title: 'اسناد گمرکی', description: 'محیط اسناد و مدارک عملیات', icon: FileText },
  { to: '/knowledge', title: 'دانشنامه', description: 'محیط دانش و منابع گمرکی', icon: BookOpen },
  { to: '/maritime', title: 'کشتیرانی', description: 'بخش کشتی‌ها و حمل دریایی', icon: Ship },
  { to: '/chat', title: 'چت سازمانی', description: 'محیط ارتباطات سازمانی', icon: MessageCircle },
  { to: '/operations', title: 'عملیات گمرکی', description: 'محیط ثبت و پیگیری عملیات', icon: ClipboardList },
  { to: '/settings', title: 'تنظیمات', description: 'تنظیمات محلی محیط کار', icon: Settings },
];

export const StagingWorkspacePage: React.FC = () => {
  const { profile, signOut } = useAuth();
  const [telegramProbeLoading, setTelegramProbeLoading] = React.useState(false);
  const [telegramProbeAttempted, setTelegramProbeAttempted] = React.useState(false);
  const [telegramProbeMessage, setTelegramProbeMessage] = React.useState<string | null>(null);

  const runTelegramArchiveProbe = async () => {
    if (telegramProbeLoading || telegramProbeAttempted) return;
    setTelegramProbeLoading(true);
    setTelegramProbeAttempted(true);
    setTelegramProbeMessage('در حال بررسی یک فایل کوچک از آرشیو تلگرام…');
    try {
      const response = await fetch('/api/admin/migration/telegram-probe', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const result = await response.json() as {
        ok?: boolean;
        error?: string;
        downloadedBytes?: number;
        sourceSizeMatches?: boolean;
        telegramSizeMatches?: boolean | null;
        sha256Computed?: boolean;
        stored?: boolean;
        contentExposed?: boolean;
      };
      if (!response.ok || result.ok !== true) {
        setTelegramProbeMessage(
          'آزمایش انجام نشد: ' + (result.error || 'PROBE_FAILED') +
          '؛ هیچ فایلی ذخیره یا نمایش داده نشد.',
        );
        return;
      }
      const sourceMatch = result.sourceSizeMatches === true
        ? 'اندازه با Metadata برابر است'
        : result.sourceSizeMatches === false ? 'اندازه با Metadata مطابقت ندارد' : 'اندازه مبدأ نامشخص است';
      const telegramMatch = result.telegramSizeMatches === true
        ? 'اندازه تلگرام نیز برابر است'
        : result.telegramSizeMatches === false ? 'اندازه تلگرام متفاوت است' : 'اندازه تلگرام گزارش نشده است';
      setTelegramProbeMessage(
        'بازیابی واقعی انجام شد؛ ' + String(result.downloadedBytes || 0) +
        ' بایت دریافت شد. ' + sourceMatch + '؛ ' + telegramMatch +
        (result.sha256Computed ? '؛ SHA-256 در حافظه محاسبه شد.' : '') +
        ' بایت‌ها ذخیره نشدند و محتوا نمایش داده نشد.',
      );
    } catch {
      setTelegramProbeMessage('ارتباط با سرویس آزمایش ناموفق بود؛ هیچ فایلی ذخیره یا نمایش داده نشد.');
    } finally {
      setTelegramProbeLoading(false);
    }
  };
  return (
    <main dir="rtl" className="min-h-screen p-4 md:p-8" style={{background:'var(--bg)',color:'var(--text)'}}>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black tracking-widest app-muted">CUSTOMS OS · RECOVERY WORKSPACE</div>
            <h1 className="mt-2 text-2xl md:text-3xl font-black">فضای کاری Customs OS</h1>
            <p className="mt-2 text-sm app-muted">ورود مستقل برقرار است؛ بازیابی اطلاعات عملیاتی در مرحله بعد انجام می‌شود.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl border app-border px-3 py-2 text-sm">{profile?.full_name || 'مدیر سامانه'}</div>
            <button onClick={() => void signOut()} className="rounded-xl border app-border px-3 py-2 text-sm font-bold">خروج</button>
          </div>
        </header>

        <section className="rounded-2xl border p-4 md:p-5" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 shrink-0" />
            <div>
              <h2 className="font-black">ورود مستقل فعال است</h2>
              <p className="mt-1 text-sm app-muted leading-7">این محیط به حساب موقت مدیر روی Cloudflare متصل است. دیتابیس قدیمی، کاربران قبلی و فایل‌های آرشیوی هنوز وارد نشده‌اند؛ بنابراین بخش‌هایی که به داده‌های سرور نیاز دارند ممکن است فعلاً اطلاعاتی نمایش ندهند یا امکان ثبت نداشته باشند.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl p-3" style={{background:'var(--bg)'}}>
              <div className="flex items-center gap-2 text-sm font-bold"><Database size={16}/> پایگاه داده جدید</div>
              <div className="mt-1 text-xs app-muted">D1 متصل؛ فعلاً فقط اطلاعات ورود و وضعیت مهاجرت</div>
            </div>
            <div className="rounded-xl p-3" style={{background:'var(--bg)'}}>
              <div className="flex items-center gap-2 text-sm font-bold"><RefreshCw size={16}/> انتقال اطلاعات</div>
              <div className="mt-1 text-xs app-muted">در انتظار واردسازی نسخه‌های پشتیبان و آرشیوها</div>
            </div>
          </div>
          {profile?.role === 'owner' && (
            <div className="mt-4 rounded-xl border p-3" style={{borderColor:'var(--border)',background:'var(--bg)'}}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold">آزمایش بازیابی واقعی تلگرام</div>
                  <div className="mt-1 text-xs app-muted leading-6">
                    فقط یک فایل دارای file_id معتبر و حداکثر ۸ مگابایت دریافت می‌شود؛ محتوا ذخیره یا نمایش داده نمی‌شود.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void runTelegramArchiveProbe()}
                  disabled={telegramProbeLoading || telegramProbeAttempted}
                  className="rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50"
                  style={{background:'var(--primary)',color:'white'}}
                >
                  {telegramProbeLoading ? 'در حال بررسی…' : telegramProbeAttempted ? 'آزمایش انجام شد' : 'اجرای آزمایش یک‌باره'}
                </button>
              </div>
              {telegramProbeMessage && (
                <p role="status" aria-live="polite" className="mt-3 text-xs app-muted leading-6">
                  {telegramProbeMessage}
                </p>
              )}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-black">بخش‌های سامانه</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {tools.map(({to,title,description,icon:Icon})=>(
              <Link key={to} to={to} className="rounded-2xl border p-4 transition hover:-translate-y-0.5" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
                <div className="mb-3 inline-flex rounded-xl p-2" style={{background:'var(--bg)'}}><Icon size={21}/></div>
                <div className="font-black">{title}</div>
                <div className="mt-1 text-xs app-muted leading-6">{description}</div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
};
