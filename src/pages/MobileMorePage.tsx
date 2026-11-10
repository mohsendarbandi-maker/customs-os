import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, Anchor, BookOpen, BriefcaseBusiness, Building2, CalendarClock,
  ClipboardCheck, ClipboardList, FileStack, FileText, FolderOpen, GitBranch,
  History, Landmark, Network, Package, Palette, Receipt, Search, Settings,
  ShieldCheck, Ship, Users, Wallet, Waves, Workflow
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type Role = 'owner' | 'admin' | 'broker' | 'accountant' | 'warehouse' | 'client';
type MobileModule = {
  title: string;
  subtitle: string;
  href: string;
  group: string;
  icon: React.ElementType;
  roles?: Role[];
};

const management: Role[] = ['owner', 'admin', 'broker'];
const staff: Role[] = ['owner', 'admin', 'broker', 'accountant', 'warehouse'];

const modules: MobileModule[] = [
  { title: 'پرونده‌ها', subtitle: 'فهرست و پیگیری پرونده‌ها', href: '/cases', group: 'عملیات گمرکی', icon: FolderOpen, roles: ['owner','admin','broker','warehouse','client'] },
  { title: 'ثبت سفارش‌ها', subtitle: 'مدیریت ثبت سفارش و بانک', href: '/registration-orders', group: 'عملیات گمرکی', icon: FileText, roles: management },
  { title: 'گزارش محموله‌ها', subtitle: 'گزارش و خروجی عملیات', href: '/shipment-reports', group: 'عملیات گمرکی', icon: ClipboardList, roles: staff },
  { title: 'ویترین محموله', subtitle: 'نمای کارت‌محور محموله‌ها', href: '/shipment-showcase', group: 'عملیات گمرکی', icon: Package, roles: ['owner','admin','broker','accountant','warehouse','client'] },
  { title: 'مرکز کنترل', subtitle: 'هشدارها و وضعیت سازمان', href: '/control', group: 'عملیات گمرکی', icon: Activity, roles: management },
  { title: 'مشتریان', subtitle: 'صاحبان کالا و اطلاعات تماس', href: '/clients', group: 'سازمان و مشتریان', icon: Users, roles: management },
  { title: 'CRM سازمانی', subtitle: 'ارتباط و مدیریت مشتریان', href: '/crm', group: 'سازمان و مشتریان', icon: BriefcaseBusiness, roles: management },
  { title: 'اسناد مشتریان', subtitle: 'مدارک و پرونده‌های مشتری', href: '/client-documents', group: 'سازمان و مشتریان', icon: Building2, roles: management },
  { title: 'کشتیرانی', subtitle: 'کشتی‌ها و خطوط کشتیرانی', href: '/maritime', group: 'حمل و اسناد', icon: Ship, roles: management },
  { title: 'جست‌وجوی کشتی', subtitle: 'مشخصات و شناسه کشتی', href: '/vessel-search', group: 'حمل و اسناد', icon: Anchor, roles: staff },
  { title: 'وضعیت دریا', subtitle: 'هوا، موج و لنگرگاه', href: '/marine-conditions', group: 'حمل و اسناد', icon: Waves, roles: staff },
  { title: 'مدیریت فایل', subtitle: 'اسناد و پوشه‌های سازمان', href: '/file-manager', group: 'حمل و اسناد', icon: FolderOpen, roles: ['owner','admin','broker','accountant','warehouse','client'] },
  { title: 'PDF Studio', subtitle: 'نمایش و پردازش اسناد PDF', href: '/pdf-studio', group: 'حمل و اسناد', icon: FileStack, roles: ['owner','admin','broker','accountant','warehouse','client'] },
  { title: 'اسناد و مجوزها', subtitle: 'مدارک گمرکی و مجوزها', href: '/documents', group: 'ترخیص و مجوزها', icon: ShieldCheck, roles: ['owner','admin','broker','warehouse','client'] },
  { title: 'قواعد مجوز', subtitle: 'قواعد و الزامات مجوزها', href: '/permit-rules', group: 'ترخیص و مجوزها', icon: ClipboardCheck, roles: management },
  { title: 'مراحل پرونده', subtitle: 'کنترل گردش کار پرونده', href: '/stage', group: 'ترخیص و مجوزها', icon: GitBranch, roles: management },
  { title: 'مالی و حسابداری', subtitle: 'گردش مالی و هزینه‌ها', href: '/finance', group: 'مالی و مدیریت', icon: Wallet, roles: ['owner','admin','accountant'] },
  { title: 'اسناد حسابداری', subtitle: 'اسناد و ثبت‌های حسابداری', href: '/finance/accounting-vouchers', group: 'مالی و مدیریت', icon: Receipt, roles: ['owner','admin','accountant','client'] },
  { title: 'ERP سازمانی', subtitle: 'میزکار جامع سازمان', href: '/erp', group: 'مالی و مدیریت', icon: Workflow, roles: ['owner','admin','accountant','broker'] },
  { title: 'تاریخچه و Audit', subtitle: 'رخدادها و سوابق تغییرات', href: '/history', group: 'مالی و مدیریت', icon: History, roles: staff },
  { title: 'تقویم و یادآورها', subtitle: 'زمان‌بندی و پیگیری کارها', href: '/reminders', group: 'ابزارها و تنظیمات', icon: CalendarClock },
  { title: 'دانشنامه گمرکی', subtitle: 'راهنماها و منابع تخصصی', href: '/knowledge', group: 'ابزارها و تنظیمات', icon: BookOpen, roles: management },
  { title: 'اتصال سازمان‌ها', subtitle: 'ارتباط با سازمان‌های همکار', href: '/settings/connections', group: 'ابزارها و تنظیمات', icon: Network, roles: ['owner','admin'] },
  { title: 'تنظیمات', subtitle: 'حساب، ظاهر و دسترسی‌ها', href: '/settings', group: 'ابزارها و تنظیمات', icon: Settings },
  { title: 'ظاهر و شخصی‌سازی', subtitle: 'تم و چیدمان برنامه', href: '/settings/appearance', group: 'ابزارها و تنظیمات', icon: Palette },
];

const roleLabels: Record<string, string> = {
  owner: 'مالک سازمان',
  admin: 'مدیر سازمان',
  broker: 'کارشناس ترخیص',
  accountant: 'حسابدار',
  warehouse: 'کارشناس انبار',
  client: 'صاحب کالا',
};

export const MobileMorePage: React.FC = () => {
  const { profile, signOut } = useAuth();
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const role = profile?.role as Role | undefined;
    const normalized = query.trim().toLocaleLowerCase('fa-IR');
    return modules.filter(module =>
      (!module.roles || (!!role && module.roles.includes(role))) &&
      (!normalized || (module.title + ' ' + module.subtitle + ' ' + module.group).toLocaleLowerCase('fa-IR').includes(normalized))
    );
  }, [profile?.role, query]);
  const groups = useMemo(() => Array.from(new Set(visible.map(module => module.group))), [visible]);

  return (
    <main className="native-more-page" dir="rtl">
      <section className="native-profile-card">
        <div className="native-profile-avatar" aria-hidden="true">
          {(profile?.full_name || 'ک').trim().slice(0, 1)}
        </div>
        <div className="native-profile-copy">
          <span className="native-eyebrow">حساب کاربری</span>
          <h1>{profile?.full_name || 'کاربر Customs OS'}</h1>
          <p>{roleLabels[profile?.role || ''] || 'عضو سازمان'}</p>
        </div>
        <Link to="/settings/profile" className="native-profile-action" aria-label="مشاهده پروفایل">
          <Users size={19} />
        </Link>
      </section>

      <label className="native-module-search">
        <Search size={19} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="جست‌وجوی ماژول، سند یا ابزار…"
          aria-label="جست‌وجو در ماژول‌ها"
        />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="پاک کردن جست‌وجو">×</button>}
      </label>

      <div className="native-more-summary">
        <div><strong>{visible.length.toLocaleString('fa-IR')}</strong><span>بخش در دسترس</span></div>
        <span>همهٔ ابزارهای کاری در یک محیط</span>
      </div>

      {groups.map(group => (
        <section className="native-module-group" key={group}>
          <div className="native-module-group-heading">
            <h2>{group}</h2>
            <span>{visible.filter(module => module.group === group).length.toLocaleString('fa-IR')}</span>
          </div>
          <div className="native-module-grid">
            {visible.filter(module => module.group === group).map(module => {
              const Icon = module.icon;
              return (
                <Link className="native-module-card" to={module.href} key={module.href}>
                  <span className="native-module-icon"><Icon size={21} strokeWidth={1.9} /></span>
                  <strong>{module.title}</strong>
                  <small>{module.subtitle}</small>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      {visible.length === 0 && (
        <div className="native-more-empty">
          <Search size={24} />
          <strong>ماژولی پیدا نشد</strong>
          <span>عبارت جست‌وجو را کوتاه‌تر کنید.</span>
        </div>
      )}

      <button className="native-signout-button" type="button" onClick={() => void signOut()}>
        خروج امن از حساب
      </button>
    </main>
  );
};

export default MobileMorePage;
