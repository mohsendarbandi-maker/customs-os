import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, MessageCircle, BarChart3, Building2, Landmark, ChevronLeft, ChevronRight,
  FileText, FileSearch, History, LayoutDashboard, Menu, Palette, Printer,
  Settings2, Ship, Waves, Users, X, LogOut, Sun, Moon, BookOpen, Wallet,
  ClipboardList, LibraryBig, Briefcase, ShieldCheck, Layers3, Search,
  Contact, Folder, ClipboardCheck, GitBranch, Receipt, Network,
  Plus, Home, CalendarDays
} from 'lucide-react';
import { useAuth, UserRole } from '../context/AuthContext';
import { useAppearance } from '../context/AppearanceContext';
import { CustomsLogo } from './CustomsLogo';
import { AIWorkspace } from './AIWorkspace';
import { OperationalAlertsDropdown } from './OperationalAlertsDropdown';

type NavItem = {
  label: string;
  en: string;
  to: string;
  icon: React.ElementType;
  group: string;
  roles?: UserRole[];
};

const allStaff: UserRole[] = ['owner', 'admin', 'broker', 'accountant', 'warehouse'];
const management: UserRole[] = ['owner', 'admin', 'broker'];
const finance: UserRole[] = ['owner', 'admin', 'accountant'];

const nav: NavItem[] = [
  { label: 'چت سازمانی', en: 'Chat', to: '/chat', icon: MessageCircle, group: 'ارتباطات' },
  { label: 'CRM سازمانی', en: 'CRM', to: '/crm', icon: Briefcase, group: 'ارتباطات', roles: management },
  { label: 'داشبورد', en: 'Dashboard', to: '/', icon: LayoutDashboard, group: 'عملیات' },
  { label: 'مرکز کنترل', en: 'Control Center', to: '/control', icon: Activity, group: 'عملیات', roles: management },
  { label: 'عملیات پرونده', en: 'Cases & Operations', to: '/operations', icon: ClipboardCheck, group: 'عملیات', roles: ['owner', 'admin', 'broker', 'warehouse', 'client'] },
  { label: 'پرونده', en: 'Cases', to: '/cases', icon: Folder, group: 'عملیات', roles: ['owner', 'admin', 'broker', 'warehouse', 'client'] },
  { label: 'یادآورها', en: 'Reminders', to: '/reminders', icon: ClipboardList, group: 'عملیات' },
  { label: 'کشتیرانی', en: 'Shipping & Vessel Search', to: '/maritime', icon: Ship, group: 'حمل و اسناد', roles: management },
  { label: 'وضعیت دریا و لنگرگاه', en: 'Marine & Anchorage', to: '/marine-conditions', icon: Waves, group: 'حمل و اسناد', roles: allStaff },
  { label: 'گمرک', en: 'Customs Offices', to: '/customs-offices', icon: Landmark, group: 'حمل و اسناد', roles: management },
{ label: 'صاحب کالا', en: 'Clients', to: '/clients', icon: Contact, group: 'حمل و اسناد', roles: management },
  { label: 'اسناد و مجوزها', en: 'Documents & Permits', to: '/documents', icon: FileText, group: 'ترخیص', roles: ['owner', 'admin', 'broker', 'warehouse', 'client'] },
  { label: 'استخراج هوشمند اسناد', en: 'Document Intelligence', to: '/documents/extract', icon: FileSearch, group: 'ترخیص', roles: ['owner', 'admin', 'broker', 'warehouse', 'client'] },
  { label: 'قواعد مجوز', en: 'Permit Rules', to: '/permit-rules', icon: ShieldCheck, group: 'ترخیص', roles: management },
  { label: 'ERP سازمانی', en: 'Enterprise ERP', to: '/erp', icon: Layers3, group: 'مالی و خروج', roles: ['owner', 'admin', 'accountant', 'broker'] },
  { label: 'مالی', en: 'Finance', to: '/finance', icon: Wallet, group: 'مالی و خروج', roles: finance },
  { label: 'اسناد حسابداری', en: 'Accounting Vouchers', to: '/finance/accounting-vouchers', icon: Receipt, group: 'مالی و خروج', roles: ['owner', 'admin', 'accountant', 'client'] },
  { label: 'مراحل پرونده', en: 'Case Stages', to: '/stage', icon: GitBranch, group: 'کنترل', roles: management },
  { label: 'تاریخچه و Audit', en: 'History & Audit', to: '/history', icon: History, group: 'کنترل', roles: allStaff },
  { label: 'چاپ اظهار', en: 'Declaration Print', to: '/print-declaration', icon: Printer, group: 'کنترل', roles: management },
  { label: 'دانشنامه گمرکی', en: 'Customs Knowledge Center', to: '/knowledge', icon: LibraryBig, group: 'دانش و منابع', roles: management },
  { label: 'اتصال سازمان‌ها', en: 'Organization Connections', to: '/settings/connections', icon: Network, group: 'سیستم', roles: ['owner', 'admin'] },
  { label: 'تنظیمات', en: 'Settings', to: '/settings', icon: Settings2, group: 'سیستم' },
];

const groups = ['ارتباطات', 'عملیات', 'حمل و اسناد', 'ترخیص', 'مالی و خروج', 'کنترل', 'دانش و منابع', 'سیستم'];

const roles: Record<string, string> = {
  owner: 'مالک',
  admin: 'مدیر',
  broker: 'کارگزار',
  accountant: 'حسابدار',
  warehouse: 'انبار',
  client: 'صاحب کالا',
};

const canSee = (item: NavItem, role?: UserRole | null) =>
  !item.roles || (!!role && item.roles.includes(role));

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { theme, setTheme, comfort, setComfort, sidebarCollapsed, setSidebarCollapsed } = useAppearance();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState('');
  // Keep JSX and CSS on the same breakpoint. Below 1024px, desktop navigation must not exist in the DOM.
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  );
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const updateViewport = () => {
      setIsCompactViewport(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    updateViewport();
    if (typeof media.addEventListener === 'function') media.addEventListener('change', updateViewport);
    else media.addListener(updateViewport);
    return () => {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', updateViewport);
      else media.removeListener(updateViewport);
    };
  }, []);

  React.useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const isChatRoute = location.pathname === '/chat' || location.pathname.startsWith('/chat/');
  const isRemindersRoute = location.pathname === '/reminders' || location.pathname.startsWith('/reminders/');
  const bare = location.pathname === '/login' || location.pathname === '/onboarding';

  const visibleNav = nav.filter((x) => canSee(x, profile?.role));
  const query = mobileSearch.trim().toLowerCase();
  const filteredNav = query
    ? visibleNav.filter(
        (item) =>
          item.label.toLowerCase().includes(query) ||
          item.en.toLowerCase().includes(query) ||
          item.group.includes(query)
      )
    : visibleNav;

  React.useEffect(() => {
    // Escape always dismisses the More sheet; route changes also close it to prevent a stranded overlay.
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        setMobileSearch('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  React.useEffect(() => {
    setMobileOpen(false);
    setMobileSearch('');
  }, [location.pathname, location.search]);

  if (bare) return <>{children}</>;

  const isActive = (to: string) => {
    const [target, qs] = to.split('?');
    if (location.pathname !== target) return false;
    const tab = qs ? new URLSearchParams(qs).get('tab') : null;
    return tab
      ? new URLSearchParams(location.search).get('tab') === tab
      : !new URLSearchParams(location.search).get('tab');
  };

  const cycleTheme = () => {
    if (comfort === 'reading') {
      setComfort('normal');
      setTheme('dark');
      return;
    }
    if (theme === 'dark') {
      setTheme('light');
      setComfort('normal');
      return;
    }
    setComfort('reading');
  };

  const appearanceLabel =
    comfort === 'reading' ? 'کتابخوان' : theme === 'light' ? 'روز' : 'شب';

  const closeMobile = () => {
    setMobileOpen(false);
    setMobileSearch('');
  };

  const go = (to: string) => {
    // Keep same-origin routes inside React Router; hard navigation can reset the active workspace.
    navigate(to);
    closeMobile();
  };

  return (
    <div className={`app-shell min-h-screen future-shell${isChatRoute ? ' is-chat-route' : ''}${isRemindersRoute ? ' is-reminders-route' : ''}`} dir="rtl">
      {!isCompactViewport && (
        <>
      {/* ── Desktop Sidebar ── */}
      <aside className={`app-sidebar hidden md:flex ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        <div className="app-brand">
          <CustomsLogo size={38} showWordmark={!sidebarCollapsed} />
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {groups.map((g) => (
            <div key={g} className="mb-4">
              <div className="app-nav-group">{!sidebarCollapsed && g}</div>
              {visibleNav
                .filter((x) => x.group === g)
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      className={`app-nav-item ${isActive(item.to) ? 'active' : ''}`}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      <Icon size={19} />
                      {!sidebarCollapsed && (
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold truncate">{item.label}</span>
                          <span className="block text-[10px] app-muted truncate">{item.en}</span>
                        </span>
                      )}
                    </NavLink>
                })}
            </div>
          ))}
        </nav>
        <div className="p-2">
          <button className="app-nav-item w-full" onClick={() => navigate('/settings/appearance')}>
            <Palette size={18} />
            {!sidebarCollapsed && <span>ظاهر و شخصی‌سازی</span>}
          </button>
          <button
            className="app-nav-item w-full"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
            {!sidebarCollapsed && <span>جمع‌کردن منو</span>}
          </button>
        </div>
      </aside>

        </>
      )}

      {/* Compact mobile header: no hamburger and no theme-cycle button. */}
      {isCompactViewport && !isChatRoute && !isRemindersRoute && (
        <header className="app-mobilebar" role="banner">
          <button
            type="button"
            className="app-mobile-title"
            aria-label={`خانه؛ بخش فعلی: ${location.pathname.startsWith('/settings') ? 'تنظیمات' : visibleNav.find((x) => isActive(x.to))?.label || 'خانه'}`}
            onClick={() => navigate('/')}
          >
            <CustomsLogo size={28} showWordmark={false} />
            <span className="mobile-current-page">
              <span className="mobile-current-page__title">
                {location.pathname.startsWith('/settings')
                  ? 'تنظیمات'
                  : visibleNav.find((x) => isActive(x.to))?.label || 'خانه'}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="icon-btn mobile-search-trigger"
            aria-label="جست‌وجو و دسترسی به بخش‌ها"
            title="جست‌وجو در بخش‌ها"
            onClick={() => setMobileOpen(true)}
          >
            <Search size={19} />
          </button>
        </header>
      )}

      {/* One role-aware More sheet: every visible section is a tile in a 3-column grid. */}
      {mobileOpen && isCompactViewport && (
        <>
          <div className="app-scrim mobile-more-scrim" onClick={closeMobile} aria-hidden="true" />
          <section className="app-mobile-drawer mobile-more-sheet" role="dialog" aria-modal="true" aria-label="بیشتر">
            <div className="mobile-drawer-header">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-3">
                  <span className="mobile-more-user-mark">{(profile?.full_name || 'ک').slice(0, 1)}</span>
                  <div className="min-w-0">
                    <b className="block truncate text-[15px]">{profile?.full_name || 'کاربر'}</b>
                    <span className="block text-xs app-muted mt-0.5">{roles[profile?.role || ''] || 'کاربر'}</span>
                  </div>
                </div>
                <button type="button" className="icon-btn" aria-label="بستن بخش بیشتر" onClick={closeMobile}>
                  <X size={18} />
                </button>
              </div>
              <div className="mobile-search-wrap">
                <Search size={17} className="mobile-search-icon" />
                <input
                  type="search"
                  className="mobile-search-input"
                  placeholder="جست‌وجو در همه بخش‌ها…"
                  value={mobileSearch}
                  onChange={(e) => setMobileSearch(e.target.value)}
                  autoComplete="off"
                  aria-label="جست‌وجو در همه بخش‌ها"
                />
                {mobileSearch && (
                  <button type="button" className="mobile-search-clear" onClick={() => setMobileSearch('')} aria-label="پاک کردن جست‌وجو">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <nav className="mobile-drawer-nav mobile-more-grid" aria-label="همه بخش‌های سامانه">
              {filteredNav.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to) || (item.to === '/operations' && location.pathname.startsWith('/operations'));
                return (
                  <button
                    key={item.to}
                    type="button"
                    className={`mobile-more-item ${active ? 'active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => go(item.to)}
                  >
                    <span className="mobile-more-icon"><Icon size={21} strokeWidth={2.1} /></span>
                    <span className="mobile-more-label">{item.label}</span>
                  </button>
                );
              })}
              <button type="button" className="mobile-more-item" onClick={() => go('/settings/appearance')}>
                <span className="mobile-more-icon"><Palette size={21} /></span>
                <span className="mobile-more-label">ظاهر و تم</span>
              </button>
              <button type="button" className="mobile-more-item" onClick={() => go('/settings/profile')}>
                <span className="mobile-more-icon"><Users size={21} /></span>
                <span className="mobile-more-label">پروفایل من</span>
              </button>
              <button type="button" className="mobile-more-item is-danger" onClick={() => { closeMobile(); void signOut(); }}>
                <span className="mobile-more-icon"><LogOut size={21} /></span>
                <span className="mobile-more-label">خروج از حساب</span>
              </button>
            </nav>
          </section>
        </>
      )}

      {/* ── Main content ── */}
      <main className={`app-main ${sidebarCollapsed ? 'sidebar-compact' : ''}`}>
        {!isCompactViewport && <header className="app-topbar">
          <div className="flex items-center gap-3 min-w-0">
            <div className="hidden lg:block">
              <div className="text-[11px] app-muted">سامانه مدیریت عملیات گمرکی و لجستیک</div>
              <div className="font-bold truncate">
                {location.pathname.startsWith('/settings')
                  ? 'تنظیمات'
                  : visibleNav.find((x) => isActive(x.to))?.label || 'Customs OS'}
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              {profile && <OperationalAlertsDropdown refreshKey={location.pathname} />}
              <span className={`app-online-chip ${online ? 'is-online' : 'is-offline'}`}>
                <span className="app-online-dot" />
                <span>{online ? 'آنلاین' : 'آفلاین'}</span>
              </span>
              <button className="theme-cycle-btn" title="تغییر حالت نمایش" onClick={cycleTheme}>
                {comfort === 'reading' ? (
                  <BookOpen size={16} />
                ) : theme === 'light' ? (
                  <Sun size={16} />
                ) : (
                  <Moon size={16} />
                )}
                <span className="hidden sm:inline">{appearanceLabel}</span>
              </button>
              <div className="relative">
                <button
                  type="button"
                  className="app-user-identity"
                  title="منوی کاربر"
                  aria-label="منوی کاربر"
                  aria-expanded={userMenuOpen}
                  onClick={() => setUserMenuOpen((v) => !v)}
                >
                  <span className="h-9 w-9 rounded-full bg-[var(--primary)] text-white grid place-items-center font-black shrink-0">
                    {(profile?.full_name || 'ک').slice(0, 1)}
                  </span>
                  <span className="text-xs hidden lg:block text-right">
                    <b>{profile?.full_name || 'کاربر'}</b>
                    <span className="block app-muted">{roles[profile?.role || ''] || ''}</span>
                  </span>
                </button>
                {userMenuOpen && (
                  <div
                    className="absolute left-0 top-[calc(100%+8px)] z-[500] w-64 rounded-2xl border app-border bg-[var(--surface)] shadow-2xl p-2"
                    dir="rtl"
                  >
                    <div className="px-3 py-3 border-b app-border">
                      <b className="block truncate">{profile?.full_name || 'کاربر'}</b>
                      <span className="block text-[10px] app-muted mt-1 truncate">
                        {roles[profile?.role || ''] || 'کاربر'}
                        {profile?.phone ? ' • ' + profile.phone : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="app-nav-item w-full text-right"
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate('/settings/profile');
                      }}
                    >
                      <Users size={17} />
                      <span>پروفایل من</span>
                    </button>
                    <button
                      type="button"
                      className="app-nav-item w-full text-right"
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate('/settings');
                      }}
                    >
                      <Settings2 size={17} />
                      <span>تنظیمات من</span>
                    </button>
                    <button
                      type="button"
                      className="app-nav-item w-full text-right"
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate('/chat');
                      }}
                    >
                      <MessageCircle size={17} />
                      <span>چت من</span>
                    </button>
                    <button
                      type="button"
                      className="app-nav-item w-full text-right"
                      onClick={() => {
                        setUserMenuOpen(false);
                        void signOut();
                      }}
                    >
                      <LogOut size={17} />
                      <span>خروج</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>}
        <div className="app-content">
          <div key={location.pathname + location.search} className="future-route-stage">
            {children}
          </div>
        </div>
      </main>
      {isCompactViewport && <nav className="app-mobile-dock" aria-label="پیمایش اصلی">
        <button type="button" className={isActive('/')?'is-active':''} aria-current={isActive('/')?'page':undefined} onClick={()=>go('/')}><Home size={21}/><span>خانه</span></button>
        <button type="button" className={location.pathname.startsWith('/operations')?'is-active':''} aria-current={location.pathname.startsWith('/operations')?'page':undefined} onClick={()=>go('/operations')}><ClipboardList size={21}/><span>عملیات</span></button>
        <button type="button" className={isRemindersRoute?'is-active':''} aria-current={isRemindersRoute?'page':undefined} onClick={()=>go('/reminders')}><CalendarDays size={21}/><span>یادآورها</span></button>
        <button type="button" className={isActive('/chat')?'is-active':''} aria-current={isActive('/chat')?'page':undefined} onClick={()=>go('/chat')}><MessageCircle size={21}/><span>چت</span></button>
        <button type="button" className={mobileOpen?'is-active':''} aria-expanded={mobileOpen} onClick={()=>setMobileOpen(v=>!v)}><Menu size={21}/><span>بیشتر</span></button>
      </nav>}
      {!isChatRoute && !isRemindersRoute && <AIWorkspace pageContext={location.pathname + location.search} />}
    </div>
  );
};
