import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, MessageCircle, Landmark, ChevronLeft, ChevronRight,
  FileText, FileSearch, History, LayoutDashboard, Palette, Printer,
  Settings2, Ship, Waves, Users, X, LogOut, Sun, Moon, BookOpen, Wallet,
  ClipboardList, LibraryBig, Briefcase, ShieldCheck, Layers3, Search,
  Contact, Folder, ClipboardCheck, GitBranch, Receipt, Network,
  Home, CalendarDays
} from 'lucide-react';
import { useAuth, UserRole } from '../context/AuthContext';
import { useAppearance } from '../context/AppearanceContext';
import { CustomsLogo } from './CustomsLogo';
import { AIWorkspace } from './AIWorkspace';
import { OperationalAlertsDropdown } from './OperationalAlertsDropdown';
import { Avatar } from './ui';
import { CloudSyncStatus } from './CloudSyncStatus';

type NavItem = {
  label: string;
  en: string;
  to: string;
  icon: React.ElementType;
  group: string;
  roles?: UserRole[];
};

type BrowserHistoryState = { idx?: number } | null;

const routeScrollPositions = new Map<string, number>();
const routeScrollStorageKey = (routeKey: string) => 'customs-os:route-scroll:v1:' + routeKey;

const isStandalonePwa = () => {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || Boolean(nav.standalone);
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
  { label: 'فایل‌منیجر', en: 'File Manager', to: '/file-manager', icon: Folder, group: 'حمل و اسناد', roles: ['owner', 'admin', 'broker', 'accountant', 'warehouse', 'client'] },
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

  // Touch-capable devices must keep the mobile shell even when "Request Desktop Website"
  // or an attached trackpad reports a wide viewport/fine pointer (notably iPadOS).
  const getDesktopLayout = () => {
    if (typeof window === 'undefined') return true;
    // Dedicated mobile origin is mobile-first by contract. Never let Safari zoom,
    // Request Desktop Website, or pointer media queries switch this origin to desktop.
    if (window.location.hostname.toLowerCase() === 'mobile.darbandicommercial.ir') return false;
    const wideViewport = window.matchMedia('(min-width: 1024px)').matches;
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    const hasTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    return wideViewport && finePointer && !hasTouch;
  };
  const [isDesktop, setIsDesktop] = useState(getDesktopLayout);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState('');
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const moreSheetRef = useRef<HTMLElement | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const widthMedia = window.matchMedia('(min-width: 1024px)');
    const pointerMedia = window.matchMedia('(pointer: fine)');
    const updateLayout = () => {
      const nextIsDesktop = getDesktopLayout();
      setIsDesktop(nextIsDesktop);
      if (nextIsDesktop) setMobileOpen(false);
    };
    updateLayout();
    widthMedia.addEventListener('change', updateLayout);
    pointerMedia.addEventListener('change', updateLayout);
    window.addEventListener('resize', updateLayout, { passive: true });
    window.addEventListener('orientationchange', updateLayout, { passive: true });
    return () => {
      widthMedia.removeEventListener('change', updateLayout);
      pointerMedia.removeEventListener('change', updateLayout);
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('orientationchange', updateLayout);
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const returnFocus = moreTriggerRef.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const focusFrame = window.requestAnimationFrame(() => moreSheetRef.current?.focus({ preventScroll: true }));
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = moreSheetRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      returnFocus?.focus({ preventScroll: true });
    };
  }, [mobileOpen]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Preserve the document scroll position per internal route. The previous version
  // remounted every route with a keyed wrapper but never restored the prior route's
  // position, so returning from a detail page could land halfway down a different page.
  useEffect(() => {
    if (location.pathname === '/login' || location.pathname === '/onboarding') return undefined;
    const routeKey = location.pathname + location.search;
    const storageKey = routeScrollStorageKey(routeKey);
    let savedPosition = routeScrollPositions.get(routeKey);
    if (savedPosition === undefined) {
      try {
        const stored = Number(sessionStorage.getItem(storageKey));
        savedPosition = Number.isFinite(stored) && stored >= 0 ? stored : 0;
      } catch {
        savedPosition = 0;
      }
    }

    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: savedPosition ?? 0, left: 0, behavior: 'auto' });
      });
    });
    const remember = () => routeScrollPositions.set(routeKey, window.scrollY);
    const persist = () => {
      const top = window.scrollY;
      routeScrollPositions.set(routeKey, top);
      try { sessionStorage.setItem(storageKey, String(top)); } catch { /* private browsing */ }
    };
    window.addEventListener('scroll', remember, { passive: true });
    window.addEventListener('pagehide', persist);
    return () => {
      persist();
      window.removeEventListener('scroll', remember);
      window.removeEventListener('pagehide', persist);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [location.pathname, location.search]);

  // Safari supplies its own browser-chrome back swipe. For an installed Home Screen
  // app (which has no browser chrome), add an RTL right-edge swipe, and only when it
  // does not start in a text field, horizontal scroller, chat, reminders, or overlay.
  useEffect(() => {
    if (isDesktop || mobileOpen || !isStandalonePwa() ||
        location.pathname === '/' || location.pathname === '/login' || location.pathname === '/onboarding') {
      return undefined;
    }
    let start: { x: number; y: number; target: EventTarget | null } | null = null;
    const ignoreSelector = [
      'input', 'textarea', 'select', '[contenteditable="true"]',
      '.overflow-x-auto', '[data-swipe-ignore="true"]', '.app-mobile-dock',
      '.app-more-sheet', '.ds-overlay', '.chat-standalone', '.reminders-app-standalone',
    ].join(',');
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { start = null; return; }
      const touch = event.touches[0];
      if (touch.clientX < window.innerWidth - 26) { start = null; return; }
      if (event.target instanceof Element && event.target.closest(ignoreSelector)) { start = null; return; }
      start = { x: touch.clientX, y: touch.clientY, target: event.target };
    };
    const onTouchEnd = (event: TouchEvent) => {
      const origin = start;
      start = null;
      if (!origin || event.changedTouches.length !== 1) return;
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - origin.x;
      const deltaY = touch.clientY - origin.y;
      if (deltaX > -84 || Math.abs(deltaY) > 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
      const historyState = window.history.state as BrowserHistoryState;
      if (typeof historyState?.idx === 'number' && historyState.idx > 0) {
        navigate(-1);
      } else {
        const fallback = location.pathname.startsWith('/operations') && location.search ? '/operations' : '/';
        navigate(fallback, { replace: true });
      }
    };
    const onTouchCancel = () => { start = null; };
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [isDesktop, mobileOpen, location.pathname, location.search, navigate]);



  // Only auth/onboarding pages intentionally bypass the shared application shell.
  // Chat and Reminders stay inside the same route tree so mobile gets one global tab bar.
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
    navigate(to);
    closeMobile();
  };

  const isPrimaryMobileRoute =
    location.pathname === '/' ||
    location.pathname === '/chat' ||
    location.pathname === '/reminders' ||
    (location.pathname === '/operations' && !location.search);
  const showMobileBack = !isPrimaryMobileRoute;

  const goBack = () => {
    closeMobile();
    const historyState = window.history.state as BrowserHistoryState;
    if (typeof historyState?.idx === 'number' && historyState.idx > 0) {
      navigate(-1);
      return;
    }
    const fallback = location.pathname.startsWith('/operations') && location.search ? '/operations' : '/';
    navigate(fallback, { replace: true });
  };

  const currentPageLabel =
    location.pathname === '/'
      ? 'خانه'
      : location.pathname.startsWith('/settings')
        ? 'تنظیمات'
        : [...visibleNav]
            .filter((item) => item.to !== '/')
            .sort((a, b) => b.to.length - a.to.length)
            .find((item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/'))
            ?.label || 'Customs OS';

  return (
    <div className={`app-shell min-h-screen future-shell ${isDesktop ? 'is-desktop-layout' : 'is-touch-layout'}`} dir="rtl">
      {/* Desktop navigation is mounted only at >=1024px. It is not merely hidden on phones. */}
      {isDesktop && (
        <aside className={`app-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
          <div className="app-brand">
            <CustomsLogo size={38} showWordmark={!sidebarCollapsed} />
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="ناوبری اصلی">
            {groups.map((g) => {
              const items = visibleNav.filter((item) => item.group === g);
              if (!items.length) return null;
              return (
                <div key={g} className="mb-4">
                  <div className="app-nav-group">{!sidebarCollapsed && g}</div>
                  {items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
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
                    );
                  })}
                </div>
              );
            })}
          </nav>
          <div className="p-2">
            <button type="button" className="app-nav-item w-full" onClick={() => navigate('/settings/appearance')}>
              <Palette size={18} />
              {!sidebarCollapsed && <span>ظاهر و شخصی‌سازی</span>}
            </button>
            <button
              type="button"
              className="app-nav-item w-full"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-label={sidebarCollapsed ? 'گسترش منو' : 'جمع کردن منو'}
            >
              {sidebarCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
              {!sidebarCollapsed && <span>جمع‌کردن منو</span>}
            </button>
          </div>
        </aside>
      )}

      {/* Compact touch header: deliberately no hamburger and no theme toggle.
          Theme settings live in More > ظاهر و شخصی‌سازی. */}
      {!isDesktop && (
        <header className="app-mobilebar" aria-label="هدر موبایل">
          {showMobileBack ? (
            <button type="button" className="icon-btn app-mobile-back" aria-label="بازگشت" title="بازگشت" onClick={goBack}>
              <ChevronRight size={19} aria-hidden="true" />
            </button>
          ) : (
            <span className="app-mobile-back-placeholder" aria-hidden="true" />
          )}
          <div className="app-mobile-title">
            <CustomsLogo size={30} showWordmark={false} />
            <span className="mobile-current-page">
              <span className="mobile-current-page__eyebrow">CUSTOMS OS</span>
              <span className="mobile-current-page__title">{currentPageLabel}</span>
            </span>
          </div>
          <button
            type="button"
            className="icon-btn app-mobile-settings"
            aria-label="تنظیمات ظاهر"
            title="تنظیمات ظاهر"
            onClick={() => navigate('/settings/appearance')}
          >
            <Settings2 size={19} />
          </button>
        </header>
      )}

      {/* The More sheet is the only secondary mobile navigation. All role-visible
          routes stay available, in a three-column grid instead of a side drawer. */}
      {mobileOpen && !isDesktop && (
        <div className="app-more-scrim" role="presentation" onClick={closeMobile}>
          <section
            ref={moreSheetRef}
            className="app-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="بیشتر"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="app-more-sheet-handle" aria-hidden="true" />
            <header className="app-more-sheet-header">
              <div className="min-w-0">
                <strong>بیشتر</strong>
                <span>{profile?.full_name || 'کاربر'} · {roles[profile?.role || ''] || 'کاربر'}</span>
              </div>
              <button type="button" className="icon-btn" aria-label="بستن بیشتر" onClick={closeMobile}>
                <X size={18} />
              </button>
            </header>
            <label className="app-more-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                placeholder="جست‌وجو در بخش‌ها…"
                aria-label="جست‌وجو در بخش‌ها"
                value={mobileSearch}
                onChange={(event) => setMobileSearch(event.target.value)}
                autoComplete="off"
              />
              {mobileSearch && (
                <button type="button" onClick={() => setMobileSearch('')} aria-label="پاک کردن جست‌وجو">
                  <X size={15} />
                </button>
              )}
            </label>
            <nav className="app-more-grid" aria-label="همه بخش‌ها">
              {filteredNav.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to) || (item.to !== '/' && location.pathname.startsWith(item.to + '/'));
                return (
                  <button
                    type="button"
                    key={item.to}
                    className={`app-more-item ${active ? 'is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => go(item.to)}
                  >
                    <span className="app-more-item-icon"><Icon size={21} strokeWidth={2} /></span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <button type="button" className={`app-more-item ${location.pathname.startsWith('/settings/appearance') ? 'is-active' : ''}`} onClick={() => go('/settings/appearance')}>
                <span className="app-more-item-icon"><Palette size={21} /></span>
                <span>ظاهر و رنگ‌بندی</span>
              </button>
              <button type="button" className="app-more-item" onClick={() => go('/settings/profile')}>
                <span className="app-more-item-icon"><Users size={21} /></span>
                <span>پروفایل من</span>
              </button>
              <button type="button" className="app-more-item" onClick={() => { closeMobile(); void signOut(); }}>
                <span className="app-more-item-icon"><LogOut size={21} /></span>
                <span>خروج از حساب</span>
              </button>
            </nav>
          </section>
        </div>
      )}

      {/* ── Main content ── */}
      <main className={`app-main ${sidebarCollapsed ? 'sidebar-compact' : ''}`}>
        {isDesktop && <header className="app-topbar">
          <div className="flex items-center gap-3 min-w-0">
            <div className="hidden lg:block">
              <div className="text-[11px] app-muted">سامانه مدیریت عملیات گمرکی و لجستیک</div>
              <div className="font-bold truncate">
                {currentPageLabel}
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              {profile && <OperationalAlertsDropdown refreshKey={location.pathname} />}
              <CloudSyncStatus online={online} enabled={Boolean(profile)} />
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
                  <Avatar name={profile?.full_name || 'کاربر'} size="md" aria-hidden="true" />
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
      {!isDesktop && <nav className="app-mobile-dock" aria-label="پیمایش سریع">
        <button type="button" className={isActive('/')?'is-active':''} aria-current={isActive('/')?'page':undefined} onClick={()=>go('/')}><Home size={21}/><span>خانه</span></button>
        <button type="button" className={location.pathname.startsWith('/operations')?'is-active':''} aria-current={location.pathname.startsWith('/operations')?'page':undefined} onClick={()=>go('/operations')}><ClipboardList size={21}/><span>عملیات</span></button>
        <button type="button" className={location.pathname.startsWith('/reminders')?'is-active':''} aria-current={location.pathname.startsWith('/reminders')?'page':undefined} onClick={()=>go('/reminders')}><CalendarDays size={21}/><span>یادآورها</span></button>
        <button type="button" className={location.pathname.startsWith('/chat')?'is-active':''} aria-current={location.pathname.startsWith('/chat')?'page':undefined} onClick={()=>go('/chat')}><MessageCircle size={21}/><span>چت</span></button>
        <button ref={moreTriggerRef} type="button" className={mobileOpen?'is-active':''} aria-label="بیشتر" aria-haspopup="dialog" aria-expanded={mobileOpen} onClick={()=>setMobileOpen(v=>!v)}><Layers3 size={21}/><span>بیشتر</span></button>
      </nav>}
      {!location.pathname.startsWith('/chat') && <AIWorkspace pageContext={location.pathname + location.search} />}
    </div>
  );
};
