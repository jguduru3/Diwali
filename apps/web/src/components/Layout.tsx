import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canAccessArea, type Area } from '@pataka/shared';
import { useAccountLanguage, useMe } from '../auth/useAuth';
import { Brand } from './Brand';
import { DemoRibbon, DemoSwitcher } from './DemoSwitcher';
import { LanguageMenu } from './LanguageMenu';
import { cx } from './ui';
import {
  House,
  ReceiptText,
  ShieldCheck,
  Store,
  TrafficCone,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { Icon } from './Icon';

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

  // Braces matter: newer browsers return a Promise from scrollTo(), which React would treat as a cleanup.
  useEffect(() => {
    window.scrollTo(0, 0);
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
      <header className="night-sky no-print sticky top-0 z-30 border-b border-white/10 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2.5 sm:flex-wrap sm:gap-3 sm:px-6 sm:pt-3 sm:pb-0">
          <Link to="/" aria-label={t('app.name')}>
            <Brand />
          </Link>
          <div className="flex items-center gap-2">
            <DemoSwitcher />
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
          <NavLink to="/about" className={navClass}>
            {t('nav.about')}
          </NavLink>
        </nav>
      </header>

      <main
        id="main"
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-24 sm:px-6 sm:py-10 sm:pb-10"
      >
        <Outlet />
      </main>

      {phone && (
        <nav
          aria-label={t('nav.tabs')}
          className="bottom-nav no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white shadow-[0_-6px_24px_rgb(46_11_94/0.08)] sm:hidden"
        >
          <NavLink to="/" end className={tabClass}>
            <Icon icon={House} className="h-6 w-6" />
            {t('nav.home')}
          </NavLink>
          {me?.role === 'customer' && (
            <NavLink to="/orders" className={tabClass}>
              <Icon icon={ReceiptText} className="h-6 w-6" />
              {t('nav.orders')}
            </NavLink>
          )}
          {visible.map((l) => (
            <NavLink key={l.to} to={l.to} className={tabClass}>
              <Icon icon={AREA_ICON[l.area]} className="h-6 w-6" />
              {t(`nav.${l.area}`)}
            </NavLink>
          ))}
          <NavLink to={me ? '/account' : '/login'} className={tabClass}>
            <Icon icon={UserRound} className="h-6 w-6" />
            {t('nav.account')}
          </NavLink>
        </nav>
      )}

      <footer className="no-print hidden border-t border-line bg-white/60 sm:block">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex items-start gap-2">
            <span aria-hidden className="text-gold-deep">
              <Icon icon={ShieldCheck} />
            </span>
            {t('safety.notice')}
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
            <span>{t('footer.licensed')}</span>
            <span>{t('footer.pay')}</span>
            <Link to="/about" className="text-plum underline-offset-4 hover:underline">
              {t('nav.about')}
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
