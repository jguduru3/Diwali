import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canAccessArea, type Area } from '@pataka/shared';
import { useAccountLanguage, useMe } from '../auth/useAuth';
import { useOrdersNeedingAnswer } from '../lib/alerts';
import { useProfiles } from '../lib/growth';
import { syncAppChrome } from '../lib/appKind';
import { Brand } from './Brand';
import { ErrorBoundary } from './ErrorBoundary';
import { OfflineBanner, PwaChrome } from './PwaChrome';
import { DemoRibbon, DemoSwitcher } from './DemoSwitcher';
import { LanguageMenu } from './LanguageMenu';
import { cx } from './ui';
import {
  BriefcaseBusiness,
  House,
  ReceiptText,
  ShoppingBag,
  ShieldCheck,
  Store,
  TrafficCone,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { Icon } from './Icon';
import { usePlanShops } from '../lib/planList';
import { CustomerAlerts } from './CustomerAlerts';
import { MultiShopFeeNotice } from './MultiShopFeeNotice';
import { BeaFloat } from './BeaFloat';
import { FirstRunHowItWorks } from './FirstRunHowItWorks';
import { StandardToggle } from './StandardToggle';
import { settings } from '../lib/settings';

const areaLinks: { to: string; area: Area }[] = [
  { to: '/shop', area: 'shop' },
  { to: '/gate', area: 'gate' },
  { to: '/admin', area: 'admin' },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    'flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition',
    isActive ? 'bg-white text-night' : 'text-white/80 hover:bg-white/10 hover:text-white',
  );

/** Customer screens where the floating game icon shows (shopping and waiting for orders). */
const GAME_PAGES = /^\/(?:$|s\/|kits\/|cart$|orders)/;

const AREA_ICON: Record<Area, LucideIcon> = { shop: Store, gate: TrafficCone, admin: ShieldCheck };

/** True below the `sm` breakpoint (false where matchMedia is missing, e.g. in tests). */
function usePhoneWidth() {
  const query = '(max-width: 639px)';
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const update = () => setPhone(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return phone;
}

/** Phone-width navigation: a fixed bar at the bottom, like the app's tab bar. */
const tabClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold',
    isActive ? 'text-plum' : 'text-muted',
  );

export function Layout() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  useAccountLanguage();
  const { pathname } = useLocation();
  const phone = usePhoneWidth();
  const visible = areaLinks.filter((l) => canAccessArea(me?.role, l.area));
  const cartShops = usePlanShops().length;
  const needAnswer = useOrdersNeedingAnswer().length;
  // Staff screens don't need a cart; customers and visitors do.
  const showCart = !me || me.role === 'customer';
  // Customers (and visitors) can also work as agents: same sign-up, same login. The portal
  // explains the role first, then Apply now starts the induction.
  const isAgent = !!useProfiles().data?.agent;
  const agentTo = '/agent';

  // Publishes the sticky header's real height as --header-h, so sticky bars below it sit flush
  // whatever the language, screen width or number of nav rows.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const set = () =>
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Braces matter: newer browsers return a Promise from scrollTo(), which React would treat as a cleanup.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  // Customer or merchant app (manifest, icon, title), kept in step with the page.
  const [app, setApp] = useState(() => syncAppChrome(pathname));
  useEffect(() => {
    setApp(syncAppChrome(pathname));
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-lg focus:bg-white focus:p-3"
      >
        {t('nav.skip')}
      </a>
      <DemoRibbon />
      <header
        ref={headerRef}
        className="glass-dark no-print sticky top-0 z-30 border-b border-white/10 pt-[env(safe-area-inset-top)] text-white"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2.5 sm:flex-wrap sm:gap-3 sm:px-6 sm:pt-3 sm:pb-0">
          <Link to="/" aria-label={t('app.name')} className="min-w-0">
            <Brand />
          </Link>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <span className="hidden sm:block">
              <DemoSwitcher />
            </span>
            {showCart && <StandardToggle />}
            <LanguageMenu />
            {me ? (
              <NavLink
                to="/account"
                className={(a) => cx(navClass(a), 'hidden sm:flex')}
                aria-label={t('nav.account')}
              >
                <Icon icon={UserRound} />
                <span className="hidden sm:inline">{t('nav.account')}</span>
              </NavLink>
            ) : (
              <NavLink to="/login" className={(a) => cx(navClass(a), 'hidden sm:flex')}>
                {t('nav.signIn')}
              </NavLink>
            )}
          </div>
        </div>
        <nav
          aria-label={t('nav.areas')}
          className="mx-auto hidden max-w-6xl gap-1 overflow-x-auto px-4 py-3 sm:flex sm:px-6"
        >
          <NavLink to="/" end className={navClass}>
            {t('nav.home')}
          </NavLink>
          {showCart && (
            <NavLink to="/cart" className={navClass}>
              {t('nav.cart')}
              {cartShops > 0 && <span className="ml-1.5 text-gold-light">{cartShops}</span>}
            </NavLink>
          )}
          {me?.role === 'customer' && (
            <NavLink to="/orders" className={navClass}>
              {t('nav.orders')}
            </NavLink>
          )}
          {visible.map((l) => (
            <NavLink key={l.to} to={l.to} className={navClass}>
              {t(`nav.${l.area}`)}
            </NavLink>
          ))}
          {showCart && (
            <NavLink to={agentTo} className={navClass}>
              {isAgent ? t('nav.agentPortal') : t('nav.becomeAgent')}
            </NavLink>
          )}
          <NavLink to="/about" className={navClass}>
            {t('nav.about')}
          </NavLink>
        </nav>
      </header>
      <CustomerAlerts />
      <FirstRunHowItWorks />
      {showCart && <MultiShopFeeNotice />}
      {settings.gameEnabled && showCart && GAME_PAGES.test(pathname) && <BeaFloat />}

      <OfflineBanner />

      <main
        id="main"
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-24 sm:px-6 sm:py-10 sm:pb-10"
      >
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <PwaChrome app={app} />

      {phone && (
        <nav
          aria-label={t('nav.tabs')}
          className="bottom-nav glass no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-line/70 shadow-[0_-6px_24px_rgb(7_58_92/0.08)] sm:hidden"
        >
          <NavLink to="/" end className={tabClass}>
            <Icon icon={House} className="h-6 w-6" />
            {t('nav.home')}
          </NavLink>
          {showCart && (
            <NavLink to="/cart" className={tabClass}>
              <span className="relative inline-flex">
                <Icon icon={ShoppingBag} className="h-6 w-6" />
                {cartShops > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-plum px-1 text-[10px] leading-none font-bold text-white">
                    {cartShops}
                  </span>
                )}
              </span>
              {t('nav.cart')}
            </NavLink>
          )}
          {me?.role === 'customer' && (
            <NavLink to="/orders" className={tabClass}>
              <span className="relative inline-flex">
                <Icon icon={ReceiptText} className="h-6 w-6" />
                {needAnswer > 0 && (
                  <span
                    className="absolute -top-1 -right-1.5 h-3 w-3 rounded-full bg-saffron ring-2 ring-white"
                    aria-label={t('alerts.badge', { count: needAnswer })}
                  />
                )}
              </span>
              {t('nav.orders')}
            </NavLink>
          )}
          {visible.map((l) => (
            <NavLink key={l.to} to={l.to} className={tabClass}>
              <Icon icon={AREA_ICON[l.area]} className="h-6 w-6" />
              {t(`nav.${l.area}`)}
            </NavLink>
          ))}
          {showCart && (
            <NavLink
              to={agentTo}
              className={tabClass}
              aria-label={isAgent ? t('nav.agentPortal') : t('nav.becomeAgent')}
            >
              <Icon icon={BriefcaseBusiness} className="h-6 w-6" />
              {t('nav.agentShort')}
            </NavLink>
          )}
          <NavLink to={me ? '/account' : '/login'} className={tabClass}>
            <Icon icon={UserRound} className="h-6 w-6" />
            {t('nav.account')}
          </NavLink>
        </nav>
      )}

      <footer className="no-print border-t border-line bg-white/60 pb-20 sm:pb-0">
        <div className="mx-auto hidden max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
            <span>{t('footer.licensed')}</span>
            <span>{t('footer.pay')}</span>
            <Link to="/about" className="text-plum underline-offset-4 hover:underline">
              {t('nav.about')}
            </Link>
          </p>
        </div>
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-0.5 px-4 py-4 text-center text-xs text-muted sm:flex-row sm:justify-between sm:px-6 sm:text-left">
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
          <p className="font-semibold text-plum">
            <a
              href={settings.companyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-4 hover:underline"
            >
              {t('footer.poweredBy')}
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
