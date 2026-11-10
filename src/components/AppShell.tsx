import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, MessageCircle, Landmark, ChevronLeft, ChevronRight,
  FileText, FileSearch, History, LayoutDashboard, Palette, Printer,
  Settings2, Ship, Waves, Users, X, LogOut, Sun, Moon, BookOpen, Wallet,
  ClipboardList, LibraryBig, Briefcase, ShieldCheck, Layers3, Search,
  Contact, Folder, ClipboardCheck, GitBranch, Receipt, Network, FileStack, FileSignature,
  Home, CalendarDays, RefreshCw
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
  { label: 'ثبت سفارش‌ها', en: 'Registration Orders', to: '/registration-orders', icon: FileText, group: 'عملیات', roles: management },
  { label: 'یادآورها', en: 'Reminders', to: '/reminders', icon: ClipboardList, group: 'عملیات' },
  { label: 'ویترین محموله', en: 'Shipment Showcase', to: '/shipment-showcase', icon: Activity, group: 'عملیات', roles: ['owner', 'admin', 'broker', 'accountant', 'warehouse', 'client'] },
  { label: 'گزارش محموله‌ها', en: 'Shipment Reports', to: '/shipment-reports', icon: ClipboardList, group: 'عملیات', roles: allStaff },
  { label: 'کشتیرانی', en: 'Shipping & Vessel Search', to: '/maritime', icon: Ship, group: 'حمل و اسناد', roles: management },
  { label: 'وضعیت دریا و لنگرگاه', en: 'Marine & Anchorage', to: '/marine-conditions', icon: Waves, group: 'حمل و اسناد', roles: allStaff },
  { label: 'گمرک', en: 'Customs Offices', to: '/customs-offices', icon: Landmark, group: 'حمل و اسناد', roles: management },
{ label: 'صاحب کالا', en: 'Clients', to: '/clients', icon: Contact, group: 'حمل و اسناد', roles: management },
  { label: 'مدیریت فایل', en: 'File Management', to: '/file-manager', icon: Folder, group: 'حمل و اسناد', roles: ['owner', 'admin', 'broker', 'accountant', 'warehouse', 'client'] },
  { label: 'PDF Studio', en: 'PDF Studio', to: '/pdf-studio', icon: FileStack, group: 'حمل و اسناد', roles: ['owner', 'admin', 'broker', 'accountant', 'warehouse', 'client'] },
  { label: 'چاپگر هوشمند EPL', en: 'EPL Print Assistant', to: '/epl-print', icon: Printer, group: 'حمل و اسناد', roles: ['owner', 'admin', 'broker', 'accountant', 'warehouse', 'client'] },
  { label: 'دبیرخانه و مکاتبات', en: 'Office Automation', to: '/office', icon: FileSignature, group: 'سیستم', roles: ['owner', 'admin', 'broker', 'accountant', 'warehouse', 'client'] },
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
 
type MobileMoreContentProps = {
  profile: any;
  items: NavItem[];
  query: string;
  onQueryChange: (value: string) => void;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
};
const MobileMoreContent: React.FC<MobileMoreContentProps> = ({
  profile, items, query, onQueryChange, onNavigate, onSignOut,
}) => {
  const sections = groups.filter(group => items.some(item => item.group === group));
  return (
    <div className="native-more-page" dir="rtl">
      <section className="native-more-profile">
        <Avatar name={profile?.full_name || 'کاربر'} size="lg" aria-hidden="true" />
        <div className="native-more-profile-copy">
          <strong>{profile?.full_name || 'کاربر'}</strong>
          <span>{roles[profile?.role || ''] || 'کاربر سامانه'}</span>
          <small>{profile?.phone || 'حساب سازمانی Customs OS'}</small>
        </div>
        <button type="button" aria-label="ویرایش پروفایل" onClick={() => onNavigate('/settings/profile')}>
          <Users size={18} />
        </button>
      </section>
      <label className="native-more-search">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          placeholder="جست‌وجوی ماژول‌ها و ابزارها"
          aria-label="جست‌وجوی ماژول‌ها و ابزارها"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          autoComplete="off"
        />
        {query && <button type="button" onClick={() => onQueryChange('')} aria-label="پاک کردن جست‌وجو"><X size={16} /></button>}
      </label>
      {sections.length ? sections.map(group => (
        <section className="native-more-section" key={group}>
          <h2>{group}</h2>
          <div className="native-more-grid">
            {items.filter(item => item.group === group).map(item => {
              const Icon = item.icon;
              return (
                <button type="button" className="native-more-module" key={item.to} onClick={() => onNavigate(item.to)}>
                  <span><Icon size={21} strokeWidth={1.9} /></span>
                  <b>{item.label}</b>
                  <small>{item.en}</small>
                </button>
              );
            })}
          </div>
        </section>
      )) : (
        <div className="native-more-empty">
          <Search size={25} />
          <strong>بخشی پیدا نشد</strong>
          <span>عبارت دیگری را جست‌وجو کنید.</span>
        </div>
      )}
      <section className="native-more-section">
        <h2>حساب و تنظیمات</h2>
        <div className="native-more-utilities">
          <button type="button" onClick={() => onNavigate('/settings/appearance')}><Palette size={19} /><span>ظاهر و شخصی‌سازی</span><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => onNavigate('/settings/profile')}><Users size={19} /><span>پروفایل من</span><ChevronLeft size={16} /></button>
          <button type="button" onClick={onSignOut}><LogOut size={19} /><span>خروج از حساب</span><ChevronLeft size={16} /></button>
        </div>
      </section>
    </div>
  );
};


export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const isChatRoute = location.pathname.startsWith('/chat');
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { theme, setTheme, comfort, setComfort, sidebarCollapsed, setSidebarCollapsed } = useAppearance();
  const [pwaUpdateAvailable, setPwaUpdateAvailable] = useState(false);
  const [pwaUpdating, setPwaUpdating] = useState(false);

  useEffect(() => {
    const onUpdateReady = () => {
      setPwaUpdateAvailable(true);
      setPwaUpdating(false);
    };
    const onUpdateStarted = () => setPwaUpdating(true);
    const onUpdateFailed = () => setPwaUpdating(false);
    window.addEventListener('customs-os:pwa-update-ready', onUpdateReady);
    window.addEventListener('customs-os:pwa-update-started', onUpdateStarted);
    window.addEventListener('customs-os:pwa-update-failed', onUpdateFailed);
    return () => {
      window.removeEventListener('customs-os:pwa-update-ready', onUpdateReady);
      window.removeEventListener('customs-os:pwa-update-started', onUpdateStarted);
      window.removeEventListener('customs-os:pwa-update-failed', onUpdateFailed);
    };
  }, []);

  const requestPwaUpdate = () => {
    if (!pwaUpdateAvailable || pwaUpdating) return;
    window.dispatchEvent(new Event('customs-os:pwa-update-request'));
  };

  // iOS "Request Desktop Website" can report a 980px CSS viewport on a phone.
  // Use the real device screen width as a second signal so the primary domain cannot
  // accidentally render a dense desktop workspace inside a phone-sized screen.
  const getNarrowDevice = () => {
    if (typeof window === 'undefined') return false;
    const viewportWidth = window.visualViewport?.width || window.innerWidth;
    const deviceWidth = window.screen?.width || viewportWidth;
    return Math.min(viewportWidth, deviceWidth) < 768;
  };

  // Touch-capable devices keep the touch shell, while phone-sized screens always
  // use phone layout even when Safari requests a desktop viewport.
  const getDesktopLayout = () => {
    if (typeof window === 'undefined') return true;
    if (window.location.hostname.toLowerCase() === 'mobile.darbandicommercial.ir') return false;
    if (getNarrowDevice()) return false;
    const wideViewport = window.matchMedia('(min-width: 1024px)').matches;
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    const hasTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    return wideViewport && finePointer && !hasTouch;
  };
  const [isDesktop, setIsDesktop] = useState(getDesktopLayout);

  // Keep the chat composer attached to the actually visible iOS viewport when the
  // browser chrome or the software keyboard changes the visual viewport.
  useEffect(() => {
    if (!isChatRoute) return;
    const shell = document.querySelector<HTMLElement>('.app-shell.is-chat-route');
    if (!shell) return;
    const viewport = window.visualViewport;
    const syncVisibleViewport = () => {
      shell.style.setProperty('--chat-visible-height', `${Math.round(viewport?.height ?? window.innerHeight)}px`);
      shell.style.setProperty('--chat-visible-top', `${Math.round(viewport?.offsetTop ?? 0)}px`);
    };
    syncVisibleViewport();
    viewport?.addEventListener('resize', syncVisibleViewport);
    viewport?.addEventListener('scroll', syncVisibleViewport);
    window.addEventListener('resize', syncVisibleViewport, { passive: true });
    window.addEventListener('orientationchange', syncVisibleViewport, { passive: true });
    return () => {
      viewport?.removeEventListener('resize', syncVisibleViewport);
      viewport?.removeEventListener('scroll', syncVisibleViewport);
      window.removeEventListener('resize', syncVisibleViewport);
      window.removeEventListener('orientationchange', syncVisibleViewport);
      shell.style.removeProperty('--chat-visible-height');
      shell.style.removeProperty('--chat-visible-top');
    };
  }, [isChatRoute]);
  const [isNarrowDevice, setIsNarrowDevice] = useState(getNarrowDevice);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState('');
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const widthMedia = window.matchMedia('(min-width: 1024px)');
    const pointerMedia = window.matchMedia('(pointer: fine)');
    const updateLayout = () => {
      const nextIsDesktop = getDesktopLayout();
      setIsDesktop(nextIsDesktop);
      setIsNarrowDevice(getNarrowDevice());
      if (nextIsDesktop) setMobileOpen(false);
    };
    updateLayout();
    widthMedia.addEventListener('change', updateLayout);
    pointerMedia.addEventListener('change', updateLayout);
    window.addEventListener('resize', updateLayout, { passive: true });
    window.addEventListener('orientationchange', updateLayout, { passive: true });
    window.visualViewport?.addEventListener('resize', updateLayout, { passive: true });
    return () => {
      widthMedia.removeEventListener('change', updateLayout);
      pointerMedia.removeEventListener('change', updateLayout);
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('orientationchange', updateLayout);
      window.visualViewport?.removeEventListener('resize', updateLayout);
    };
  }, []);



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
    const mobileScroller = !isDesktop
      ? document.querySelector<HTMLElement>('.app-shell .app-content')
      : null;
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
        if (isDesktop) {
          window.scrollTo({ top: savedPosition ?? 0, left: 0, behavior: 'auto' });
        } else {
          mobileScroller?.scrollTo({ top: savedPosition ?? 0, left: 0, behavior: 'auto' });
        }
      });
    });
    const currentTop = () => isDesktop ? window.scrollY : (mobileScroller?.scrollTop ?? 0);
    const remember = () => routeScrollPositions.set(routeKey, currentTop());
    const persist = () => {
      const top = currentTop();
      routeScrollPositions.set(routeKey, top);
      try { sessionStorage.setItem(storageKey, String(top)); } catch { /* private browsing */ }
    };
    if (isDesktop) window.addEventListener('scroll', remember, { passive: true });
    else mobileScroller?.addEventListener('scroll', remember, { passive: true });
    window.addEventListener('pagehide', persist);
    return () => {
      persist();
      if (isDesktop) window.removeEventListener('scroll', remember);
      else mobileScroller?.removeEventListener('scroll', remember);
      window.removeEventListener('pagehide', persist);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [isDesktop, location.pathname, location.search]);

  // Safari supplies its own browser-chrome back swipe. For an installed Home Screen
  // app (which has no browser chrome), add an RTL right-edge swipe, and only when it
  // does not start in a text field, horizontal scroller, chat, reminders, or overlay.
  useEffect(() => {
    if (isDesktop || !isStandalonePwa() ||
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
  }, [isDesktop, location.pathname, location.search, navigate]);



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
  const moreNavItems = filteredNav.filter(item => !['/', '/reminders', '/operations', '/chat'].includes(item.to));

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
    setMobileSearch('');
  };

  const go = (to: string) => {
    navigate(to);
    closeMobile();
  };

  const isMoreRoute = location.pathname === '/more';
  const isPrimaryMobileRoute =
    location.pathname === '/' ||
    location.pathname === '/chat' ||
    location.pathname === '/reminders' ||
    location.pathname === '/more' ||
    (location.pathname === '/operations' && !location.search);
  const showMobileBack = !isPrimaryMobileRoute;
  const isMoreTab = isMoreRoute || !(
    location.pathname === '/' ||
    location.pathname.startsWith('/reminders') ||
    location.pathname.startsWith('/operations') ||
    location.pathname.startsWith('/finance/shipments/') ||
    location.pathname.startsWith('/chat')
  );

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
    location.pathname === '/' ? 'خانه'
      : location.pathname.startsWith('/reminders') ? 'یادآورها'
      : location.pathname.startsWith('/operations') ? 'عملیات پرونده'
      : location.pathname.startsWith('/finance/shipments/') ? 'جزئیات محموله'
      : location.pathname.startsWith('/chat') ? 'چت سازمانی'
      : isMoreRoute ? 'بیشتر'
      : location.pathname.startsWith('/settings') ? 'تنظیمات'
      : [...visibleNav]
          .filter((item) => item.to !== '/')
          .sort((a, b) => b.to.length - a.to.length)
          .find((item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/'))
          ?.label || 'بیشتر';

  return (
    <div data-route={location.pathname} className={`app-shell min-h-screen future-shell ${isDesktop ? 'is-desktop-layout' : 'is-touch-layout'} ${isNarrowDevice ? 'is-narrow-device' : ''} ${isChatRoute ? 'is-chat-route' : ''}`} dir="rtl">
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
        <>
          <div className="native-system-status" aria-hidden="true" />
          <header className="app-mobilebar native-app-header" aria-label="هدر اصلی برنامه">
            {showMobileBack ? (
              <button type="button" className="native-header-back" aria-label="بازگشت" title="بازگشت" onClick={goBack}>
                <ChevronRight size={21} aria-hidden="true" />
              </button>
            ) : (
              <span className="native-header-mark" aria-hidden="true"><CustomsLogo size={29} showWordmark={false} /></span>
            )}
            <div className="app-mobile-title native-header-title">
              <span className="mobile-current-page">
                <span className="mobile-current-page__eyebrow">CUSTOMS OS · عملیات گمرکی و لجستیک</span>
                <span className="mobile-current-page__title">{currentPageLabel}</span>
              </span>
            </div>
            <button
              type="button"
              className="native-header-action"
              aria-label={location.pathname.startsWith('/operations') ? 'ثبت محموله جدید' : location.pathname.startsWith('/reminders') ? 'یادآور جدید' : location.pathname.startsWith('/chat') ? 'گفت‌وگوی جدید' : 'تنظیمات'}
              title={location.pathname.startsWith('/operations') ? 'ثبت محموله جدید' : location.pathname.startsWith('/reminders') ? 'یادآور جدید' : location.pathname.startsWith('/chat') ? 'گفت‌وگوی جدید' : 'تنظیمات'}
              onClick={() => {
                if (location.pathname.startsWith('/operations')) {
                  go('/operations?tab=pre-declaration');
                } else if (location.pathname.startsWith('/reminders')) {
                  window.dispatchEvent(new Event('customs-os:reminder-compose'));
                } else if (location.pathname.startsWith('/chat')) {
                  window.dispatchEvent(new Event('customs-os:chat-new-message'));
                } else {
                  navigate('/settings/appearance');
                }
              }}
            >
              {location.pathname.startsWith('/operations') ? <FileSignature size={19} />
                : location.pathname.startsWith('/reminders') ? <CalendarDays size={19} />
                : location.pathname.startsWith('/chat') ? <Users size={19} />
                : <Settings2 size={19} />}
            </button>
          </header>
        </>
      )}

      {/* ── Main content ── */}
      <main className={`app-main ${sidebarCollapsed ? 'sidebar-compact' : ''} ${isChatRoute ? 'is-chat-main' : ''}`}>
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
              {pwaUpdateAvailable && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="به‌روزرسانی برنامه"
                  title={pwaUpdating ? 'در حال فعال‌سازی نسخه جدید…' : 'نسخه جدید آماده است؛ برای به‌روزرسانی بزنید'}
                  onClick={requestPwaUpdate}
                  disabled={pwaUpdating}
                >
                  <RefreshCw size={17} className={pwaUpdating ? 'animate-spin' : ''} />
                </button>
              )}
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
        <div className={`app-content ${isChatRoute ? 'is-chat-content' : ''}`}>
          <div key={location.pathname + location.search} className={`future-route-stage ${isChatRoute ? 'is-chat-stage' : ''} ${isMoreRoute ? 'is-more-stage' : ''}`}>
            {isMoreRoute ? (
              <MobileMoreContent
                profile={profile}
                items={moreNavItems}
                query={mobileSearch}
                onQueryChange={setMobileSearch}
                onNavigate={go}
                onSignOut={() => { closeMobile(); void signOut(); }}
              />
            ) : children}
          </div>
        </div>
      </main>
      {pwaUpdateAvailable && !isDesktop && (
        <div className="app-pwa-update-prompt" role="status" aria-live="polite">
          <div className="app-pwa-update-copy">
            <RefreshCw size={17} className={pwaUpdating ? 'animate-spin' : ''} aria-hidden="true" />
            <span>{pwaUpdating ? 'در حال آماده‌سازی نسخه جدید…' : 'نسخه جدید برنامه آماده است'}</span>
          </div>
          <button type="button" onClick={requestPwaUpdate} disabled={pwaUpdating}>
            {pwaUpdating ? 'در حال به‌روزرسانی' : 'به‌روزرسانی'}
          </button>
        </div>
      )}
      {!isDesktop && createPortal(<nav className="app-mobile-dock app-mobile-viewport-dock native-bottom-tabs" aria-label="پیمایش اصلی برنامه">
        <button type="button" className={location.pathname === '/' ? 'is-active' : ''} aria-current={location.pathname === '/' ? 'page' : undefined} onClick={() => go('/')}>
          <Home size={22} strokeWidth={1.9} /><span>خانه</span>
        </button>
        <button type="button" className={location.pathname.startsWith('/reminders') ? 'is-active' : ''} aria-current={location.pathname.startsWith('/reminders') ? 'page' : undefined} onClick={() => go('/reminders')}>
          <CalendarDays size={22} strokeWidth={1.9} /><span>یادآورها</span>
        </button>
        <button type="button" className={location.pathname.startsWith('/operations') || location.pathname.startsWith('/finance/shipments/') ? 'is-active' : ''} aria-current={location.pathname.startsWith('/operations') || location.pathname.startsWith('/finance/shipments/') ? 'page' : undefined} onClick={() => go('/operations')}>
          <ClipboardList size={22} strokeWidth={1.9} /><span>عملیات</span>
        </button>
        <button type="button" className={location.pathname.startsWith('/chat') ? 'is-active' : ''} aria-current={location.pathname.startsWith('/chat') ? 'page' : undefined} onClick={() => go('/chat')}>
          <MessageCircle size={22} strokeWidth={1.9} /><span>چت</span>
        </button>
        <button type="button" className={isMoreTab ? 'is-active' : ''} aria-current={isMoreTab ? 'page' : undefined} onClick={() => go('/more')}>
          <Layers3 size={22} strokeWidth={1.9} /><span>بیشتر</span>
        </button>
      </nav>, document.body)}
      {!location.pathname.startsWith('/chat') && <AIWorkspace pageContext={location.pathname + location.search} />}
    </div>
  );
};
