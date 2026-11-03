import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { canAccessArea, type Area } from '@pataka/shared';
import { useAccountLanguage, useMe } from '../auth/useAuth';
import { useClaimPendingReferral } from '../lib/referral';
import { Brand } from './Brand';
import { DemoRibbon, DemoSwitcher } from './DemoSwitcher';
import { LanguageMenu } from './LanguageMenu';
import { cx } from './ui';
import { ShieldCheck } from 'lucide-react';
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

export function Layout() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  useAccountLanguage();
  useClaimPendingReferral(!!me);
  const { pathname } = useLocation();
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
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 pt-3 sm:px-6">
          <Link to="/" aria-label={t('app.name')}>
            <Brand />
          </Link>
          <div className="flex items-center gap-2">
            <DemoSwitcher />
            <LanguageMenu />
            {me ? (
              <NavLink to="/account" className={navClass} aria-label={t('nav.account')}>
                <span aria-hidden>◉</span>
                <span className="hidden sm:inline">{t('nav.account')}</span>
              </NavLink>
            ) : (
              <NavLink to="/login" className={navClass}>
                {t('nav.signIn')}
              </NavLink>
            )}
          </div>
        </div>
        <nav
          aria-label={t('nav.areas')}
          className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-3 sm:px-6"
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

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <Outlet />
      </main>

      <footer className="no-print border-t border-line bg-white/60">
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
